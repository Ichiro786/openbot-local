package run.openbot.engine

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class EngineNotInstalledException : CodedException("The OpenBot engine is not installed yet; call start() first")

class EngineCommandException(message: String) : CodedException(message)

class EngineControlException(message: String) : CodedException(message)

/**
 * JS surface of the local engine. The engine itself lives in [EngineService]; this module starts and
 * stops it, mirrors [EngineState] to JS as `onStatusChange`, and runs one-off guest commands.
 */
class OpenBotEngineModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OpenBotEngine")

    Events("onStatusChange", "onCommandOutput", "onCommandExit", "onStorageProgress")

    OnCreate {
      val ctx = appContext.reactContext?.applicationContext
      if (ctx != null) {
        // Build 9: keep the last native crash for the "Copy crash log" screen on the next launch.
        CrashCapture.install(ctx)
        CrashCapture.collectLastExit(ctx)
        // Seed the installed version so status() is meaningful before the service ever ran.
        val installed = EngineInstaller(ctx).installedVersion()
        EngineState.update { if (it.installedVersion == null) it.copy(installedVersion = installed) else it }
      }
      scope.launch {
        EngineState.status.collect { sendEvent("onStatusChange", it.toMap()) }
      }
    }

    OnDestroy {
      scope.cancel()
    }

    /** Starts the foreground service: installs the payload on first run, then runs the engine. */
    AsyncFunction("start") {
      EngineService.send(context, EngineService.ACTION_START)
    }

    AsyncFunction("stop") {
      EngineService.send(context, EngineService.ACTION_STOP)
    }

    AsyncFunction("restart") {
      EngineService.send(context, EngineService.ACTION_RESTART)
    }

    /** Downloads and swaps in the newest payload (if newer), then restarts the engine. */
    AsyncFunction("update") {
      EngineService.send(context, EngineService.ACTION_UPDATE)
    }

    /** Idempotent; OnCreate already installs it. Kept for an early call from JS. */
    Function("installCrashHandler") {
      appContext.reactContext?.applicationContext?.let { CrashCapture.install(it) }
      Unit
    }

    Function("status") {
      EngineState.current.toMap()
    }

    Function("isServiceRunning") {
      EngineService.isRunning
    }

    AsyncFunction("getLogTail") { lines: Int ->
      EngineLog.get(context).tail(lines)
    }

    AsyncFunction("clearLogs") {
      EngineLog.get(context).clear()
    }

    AsyncFunction("checkForUpdate") Coroutine { ->
      val installer = EngineInstaller(context)
      val latest = installer.checkForUpdate(force = true)
      val installed = installer.installedVersion()
      mapOf(
        "installedVersion" to installed,
        "latestVersion" to latest?.tag,
        "latestBytes" to (latest?.size ?: -1L).toDouble(),
        "verifiable" to (latest != null && (latest.sha256 != null || latest.sha256Url != null)),
        "updateAvailable" to (latest != null && installed != null && installer.compareTags(latest.tag, installed) > 0),
        "error" to if (latest == null) installer.lastCheckError ?: "Could not reach the release source; see the log" else null,
      )
    }

    /**
     * Runs `/bin/sh -c <command>` inside the rootfs. Output arrives as `onCommandOutput` events
     * tagged with [id] while it runs; the promise resolves with the exit code and captured output.
     */
    AsyncFunction("runCommand") Coroutine { id: String, command: String, timeoutMs: Double? ->
      val ctx = context
      if (!EngineInstaller(ctx).isInstalled()) throw EngineNotInstalledException()
      val result = try {
        CommandRunner.run(ctx, id, command, timeoutMs?.toLong()) { stream, chunk ->
          sendEvent("onCommandOutput", mapOf("id" to id, "stream" to stream, "chunk" to chunk))
        }
      } catch (e: IllegalStateException) {
        throw EngineCommandException(e.message ?: "command failed")
      } catch (e: IllegalArgumentException) {
        throw EngineCommandException(e.message ?: "command failed")
      }
      val body = mapOf(
        "id" to id,
        "exitCode" to result.exitCode,
        "output" to result.output,
        "timedOut" to result.timedOut,
        "cancelled" to result.cancelled,
      )
      sendEvent("onCommandExit", body)
      body
    }

    /** Writes to a running command's stdin (e.g. a newline to accept a prompt). */
    Function("writeCommandInput") { id: String, text: String ->
      CommandRunner.write(id, text)
    }

    Function("cancelCommand") { id: String ->
      CommandRunner.cancel(id)
    }

    /**
     * OpenBot's control socket (README-ENGINE.md, "Control socket directly from Kotlin"). Each call
     * resolves `{ status, ok, fields, body }`; `fields` is the parsed `key=value` answer.
     */
    AsyncFunction("controlStatus") Coroutine { ->
      control("GET", "/v1/status", emptyMap(), 3000)
    }

    /** Email-code sign-in, step 1: the server mails a code and answers `challenge=...`. */
    AsyncFunction("loginStart") Coroutine { email: String, name: String? ->
      control("POST", "/v1/login/start", formOf("email" to email, "name" to name))
    }

    /** Step 2: the code from the mail, with the challenge from loginStart. */
    AsyncFunction("loginVerify") Coroutine { challenge: String, code: String, name: String? ->
      control("POST", "/v1/login/verify", formOf("challenge" to challenge, "code" to code, "name" to name), 30_000)
    }

    AsyncFunction("loginClaim") Coroutine { ->
      control("POST", "/v1/login/claim", emptyMap(), 30_000)
    }

    AsyncFunction("logout") Coroutine { ->
      control("POST", "/v1/logout", emptyMap())
    }

    /**
     * Settings › Local engine › Storage: sizes in bytes per category, Android's own figures and the
     * guards the cleanups use. Runs off the main thread; progress arrives as `onStorageProgress`.
     */
    AsyncFunction("storageScan") Coroutine { ->
      EngineStorage.scan(context) { files, bytes ->
        sendEvent("onStorageProgress", mapOf("files" to files.toDouble(), "bytes" to bytes.toDouble()))
      }
    }

    /** Cleans one category (previous, partial, downloads, logs, packageCaches, appCache); resolves with the bytes freed. */
    AsyncFunction("storageClean") Coroutine { category: String ->
      EngineStorage.clean(context, category)
    }

    AsyncFunction("getConfig") {
      EngineConfig.load(context).toMap()
    }

    AsyncFunction("setConfig") { input: EngineConfigInput ->
      EngineConfig.save(context, input)
      EngineConfig.load(context).toMap()
    }

    /** Deletes the payload so the next start() downloads it again. Stops the engine first. */
    AsyncFunction("reset") Coroutine { ->
      EngineService.send(context, EngineService.ACTION_STOP)
      kotlinx.coroutines.delay(1500)
      EngineInstaller(context).uninstall()
      EngineLog.get(context).system("Payload removed")
    }

    /** Android 13+: asks for POST_NOTIFICATIONS so the "engine running" notification shows. */
    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(mapOf("granted" to true, "status" to "granted", "canAskAgain" to true, "expires" to "never"))
      } else {
        Permissions.askForPermissionsWithPermissionsManager(
          appContext.permissions,
          promise,
          Manifest.permission.POST_NOTIFICATIONS,
        )
      }
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Opens the system "allow background use" dialog once (or again with force). Resolves true when
     * the app is already exempt, false when the dialog was shown or skipped.
     */
    AsyncFunction("requestIgnoreBatteryOptimizations") { force: Boolean ->
      requestBatteryExemption(force)
    }.runOnQueue(Queues.MAIN)

    // ---------------------------------------------------------------------------------------------
    // Live Updates (Android 16 ProgressStyle / promoted ongoing) for running agent turns
    // ---------------------------------------------------------------------------------------------

    /** Shows or updates the Live Update from the island props (JSON of AgentLiveActivityProps). */
    Function("showLiveUpdate") { json: String ->
      LiveUpdates.show(context, json)
    }

    Function("endLiveUpdate") {
      LiveUpdates.end(context)
    }

    Function("isLiveUpdateShown") {
      LiveUpdates.isShown()
    }

    /** The accent (#RRGGBB) that colors the track; null for the brand color. */
    Function("setLiveUpdateAccent") { color: String? ->
      LiveUpdates.setAccent(color)
    }

    /** Android 16+: whether the user lets the app promote Live Updates to the status bar chip. */
    Function("canPromoteLiveUpdates") {
      LiveUpdates.canPromote(context)
    }

    /** Opens the system page where the user allows Live Updates (promoted notifications). */
    Function("openLiveUpdateSettings") {
      val ctx = context
      val intent = if (Build.VERSION.SDK_INT >= 36) {
        Intent("android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS")
          .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
      }
      val activity = appContext.currentActivity
      runCatching {
        if (activity != null) activity.startActivity(intent) else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }.recoverCatching {
        val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(fallback)
      }
      Unit
    }

    // ---------------------------------------------------------------------------------------------
    // Material You (Android 12+): the wallpaper palette
    // ---------------------------------------------------------------------------------------------

    Function("getSdkInt") {
      Build.VERSION.SDK_INT
    }

    /**
     * The system tonal palettes as #RRGGBB, keyed like `accent1_600` / `neutral2_50`. Null below
     * Android 12, where there is no wallpaper palette.
     */
    Function("getDynamicColors") {
      dynamicColors(context)
    }
  }

  private fun dynamicColors(ctx: Context): Map<String, String>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    val shades = intArrayOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)
    val palettes = listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")
    val out = LinkedHashMap<String, String>()
    for (palette in palettes) {
      for (shade in shades) {
        @SuppressLint("DiscouragedApi")
        val id = ctx.resources.getIdentifier("system_${palette}_$shade", "color", "android")
        if (id == 0) continue
        val color = ctx.getColor(id)
        out["${palette}_$shade"] = String.format("#%06X", 0xFFFFFF and color)
      }
    }
    return out.takeIf { it.isNotEmpty() }
  }

  private fun formOf(vararg pairs: Pair<String, String?>): Map<String, String> =
    pairs.mapNotNull { (k, v) -> v?.takeIf { it.isNotBlank() }?.let { k to it } }.toMap()

  private suspend fun control(method: String, path: String, form: Map<String, String>, timeoutMs: Int = 15_000): Map<String, Any?> {
    val socket = ControlSocket(EnginePaths(context).controlSocket)
    val response = try {
      withContext(Dispatchers.IO) { socket.request(method, path, form, timeoutMs) }
    } catch (e: java.io.IOException) {
      throw EngineControlException(e.message ?: "control socket failed")
    }
    return mapOf(
      "status" to response.status,
      "ok" to response.ok,
      "fields" to response.fields,
      "body" to response.body,
    )
  }

  @SuppressLint("BatteryLife")
  private fun requestBatteryExemption(force: Boolean): Boolean {
    val ctx = context
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    if (pm.isIgnoringBatteryOptimizations(ctx.packageName)) return true
    val prefs = EngineConfig.prefs(ctx)
    if (prefs.getBoolean("askedBatteryExemption", false) && !force) return false
    prefs.edit().putBoolean("askedBatteryExemption", true).apply()
    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
    val activity = appContext.currentActivity
    try {
      if (activity != null) activity.startActivity(intent)
      else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
      // Some OEM builds lack the dialog; fall back to the battery optimisation list.
      val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { ctx.startActivity(list) }
    }
    return false
  }
}
