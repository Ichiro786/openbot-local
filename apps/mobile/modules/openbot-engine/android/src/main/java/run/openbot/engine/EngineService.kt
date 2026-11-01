package run.openbot.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/**
 * Foreground service (type specialUse) that keeps the OpenBot engine alive:
 *  1. installs/updates the payload when needed (bundled APK asset first, network as fallback);
 *  2. runs `proot ... /bin/bash /root/openbot-start.sh` with a partial wake lock;
 *  3. reports RUNNING when `$R/run/openbot/engine.state` says `state=ready` with a live
 *     `engine_pid` (or the log prints OPENBOT_LOCAL_READY);
 *  4. restarts on a crash with backoff 1 s .. 60 s (reset after a minute up), except for launcher
 *     exit codes a restart cannot fix;
 *  5. stops gracefully: SIGTERM to the launcher (`engine_pid`), or `openbot-start.sh --stop` in a
 *     second proot, and only after the stop window kills proot (whose --kill-on-exit would otherwise
 *     SIGKILL OpenBot before it closes its database).
 */
class EngineService : Service() {
  companion object {
    const val ACTION_START = "run.openbot.engine.action.START"
    const val ACTION_STOP = "run.openbot.engine.action.STOP"
    const val ACTION_RESTART = "run.openbot.engine.action.RESTART"
    const val ACTION_UPDATE = "run.openbot.engine.action.UPDATE"

    const val CHANNEL_ID = "openbot_engine"
    const val NOTIFICATION_ID = 0x0B07

    private const val MAX_BACKOFF_MS = 60_000L
    private const val STABLE_AFTER_MS = 60_000L
    private const val WAKE_LOCK_TIMEOUT_MS = 12L * 60 * 60 * 1000

    @Volatile var isRunning = false
      private set

    /** Starts or signals the service. Start it while the app is in the foreground (Android 12+). */
    fun send(context: Context, action: String) {
      val intent = Intent(context, EngineService::class.java).setAction(action)
      if (action == ACTION_STOP) {
        if (!isRunning) {
          EngineState.update { it.copy(phase = EnginePhase.STOPPED, pid = null, nextRestartAtMs = null) }
          return
        }
        context.startService(intent)
      } else {
        ContextCompat.startForegroundService(context, intent)
      }
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val lifecycle = Mutex()
  private var supervisor: Job? = null
  @Volatile private var process: Process? = null
  @Volatile private var stopRequested = false
  private var wakeLock: PowerManager.WakeLock? = null
  private lateinit var log: EngineLog
  private lateinit var paths: EnginePaths

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    isRunning = true
    log = EngineLog.get(this)
    paths = EnginePaths(this)
    createChannel()
    scope.launch {
      EngineState.status
        .map { Triple(it.phase, it.installStep, it.progress?.let { p -> (p * 100).toInt() }) }
        .distinctUntilChanged()
        .collect { if (!stopRequested) notifyStatus() }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action ?: ACTION_START // null: a sticky restart by the system
    if (action == ACTION_STOP) {
      scope.launch { stopAll(stopService = true) }
      return START_NOT_STICKY
    }
    if (!goForeground()) return START_NOT_STICKY
    scope.launch {
      lifecycle.withLock {
        when (action) {
          ACTION_RESTART -> relaunch(update = false)
          ACTION_UPDATE -> relaunch(update = true)
          else -> if (supervisor?.isActive != true) relaunch(update = false)
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    stopRequested = true
    // Last resort when the system tears the service down: try the graceful path briefly.
    process?.let { p -> Thread { gracefulStopBlocking(p, 5_000) }.start() }
    scope.cancel()
    releaseWakeLock()
    super.onDestroy()
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------

  private suspend fun relaunch(update: Boolean) {
    supervisor?.let {
      stopEngine()
      it.cancelAndJoin()
    }
    stopRequested = false
    supervisor = scope.launch { supervise(update) }
  }

  private suspend fun stopAll(stopService: Boolean) {
    lifecycle.withLock {
      stopRequested = true
      log.system("Stop requested")
      EngineState.update { it.copy(phase = EnginePhase.STOPPING, message = "Stopping the engine") }
      stopEngine()
      supervisor?.cancelAndJoin()
      supervisor = null
      CommandRunner.cancelAll()
      EngineState.update { it.copy(phase = EnginePhase.STOPPED, pid = null, nextRestartAtMs = null, installStep = null, progress = null, message = null) }
      releaseWakeLock()
    }
    if (stopService) {
      withContext(Dispatchers.Main) {
        ServiceCompat.stopForeground(this@EngineService, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
  }

  /** Gracefully stops the running launcher, if any. */
  private suspend fun stopEngine() {
    val p = process ?: return
    val config = EngineConfig.load(this)
    withContext(Dispatchers.IO + NonCancellable) { gracefulStopBlocking(p, config.stopTimeoutMs) }
  }

  /**
   * SIGTERM the launcher (engine_pid from the state file); without a pid, run
   * `openbot-start.sh --stop` in a second proot. Wait up to [timeoutMs] for proot to exit on its
   * own, and only then terminate proot.
   */
  private fun gracefulStopBlocking(p: Process, timeoutMs: Long) {
    if (!p.isAliveCompat()) return
    val state = LauncherState.read(paths.stateFile)
    val pid = state?.enginePid?.takeIf { LauncherState.pidAlive(it) }
    if (pid != null) {
      log.system("SIGTERM launcher pid $pid")
      try {
        Os.kill(pid, OsConstants.SIGTERM)
      } catch (e: ErrnoException) {
        log.system("SIGTERM failed: ${e.message}")
      }
    } else {
      log.system("No launcher pid; running openbot-start.sh --stop")
      runCatching {
        val stopper = ProotCommand.processBuilder(paths, EngineConfig.load(this), ProotCommand.launcher("--stop")).start()
        stopper.inputStream.bufferedReader().useLines { lines -> lines.forEach { log.append(it, "stop") } }
        stopper.waitFor()
      }.onFailure { log.system("--stop failed: ${it.message}") }
    }
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    while (p.isAliveCompat() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(200)
    if (p.isAliveCompat()) {
      log.system("Engine did not stop within ${timeoutMs / 1000}s; killing proot")
      p.terminate()
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Supervisor
  // ---------------------------------------------------------------------------------------------

  private suspend fun supervise(update: Boolean) {
    val config = EngineConfig.load(this)
    val installer = EngineInstaller(this, paths, config)

    ProotCommand.preflight(paths)?.let {
      fail(it)
      return
    }

    try {
      val release = if (update) {
        EngineState.installing(InstallStep.CHECKING, null, message = "Looking for an engine update")
        val remote = installer.resolveRemote()
        val installed = installer.installedVersion()
        remote.takeIf { installed == null || installer.compareTags(it.tag, installed) > 0 }
          ?: installer.pendingInstall()
      } else {
        installer.pendingInstall()
      }
      if (release != null) installer.install(release)
      if (!installer.isInstalled()) throw EngineInstallException("No engine payload in this build and none downloadable")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Throwable) {
      log.system("Install failed: ${e.message}")
      fail(e.message ?: e.javaClass.simpleName)
      return
    }
    EngineState.update { it.copy(installedVersion = installer.installedVersion(), installStep = null, progress = null) }
    scope.launch { installer.checkForUpdate(force = false) }

    var backoff = 1000L
    var restarts = 0
    while (currentCoroutineContext().isActive && !stopRequested) {
      val startedAt = SystemClock.elapsedRealtime()
      val exit = try {
        runEngineOnce(config)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Throwable) {
        log.system("Engine failed to start: ${e.message}")
        -1
      }
      if (stopRequested || !currentCoroutineContext().isActive) break
      val reason = LauncherState.read(paths.stateFile)?.reason
      val description = LauncherExit.describe(exit) + (reason?.let { ": $it" } ?: "")
      log.system("Launcher exited with $exit ($description)")
      if (exit == 0) {
        // A clean stop we did not ask for (e.g. `openbot-start.sh --stop` from a terminal).
        EngineState.update { it.copy(phase = EnginePhase.STOPPED, pid = null, lastExitCode = 0, message = null) }
        releaseWakeLock()
        return
      }
      if (LauncherExit.isFatal(exit)) {
        EngineState.update { it.copy(phase = EnginePhase.ERROR, pid = null, lastExitCode = exit, message = description) }
        releaseWakeLock()
        notifyStatus()
        return
      }
      if (SystemClock.elapsedRealtime() - startedAt > STABLE_AFTER_MS) backoff = 1000L
      restarts++
      if (!config.autoRestart) {
        EngineState.update { it.copy(phase = EnginePhase.CRASHED, pid = null, lastExitCode = exit, restartCount = restarts, message = description) }
        releaseWakeLock()
        return
      }
      val next = System.currentTimeMillis() + backoff
      EngineState.update {
        it.copy(
          phase = EnginePhase.CRASHED,
          pid = null,
          lastExitCode = exit,
          restartCount = restarts,
          nextRestartAtMs = next,
          message = "$description; restarting in ${backoff / 1000}s",
        )
      }
      delay(backoff)
      backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
    }
  }

  /** Runs the launcher until it exits; returns its exit code (proot passes it through). */
  private suspend fun runEngineOnce(config: EngineConfig): Int = withContext(Dispatchers.IO) {
    EngineState.update {
      it.copy(phase = EnginePhase.STARTING, installStep = null, progress = null, nextRestartAtMs = null, message = "Starting the engine")
    }
    reapOrphanLauncher()
    // A state file from an earlier run must not read as "ready" for this one.
    paths.stateFile.delete()
    if (config.syncDns) writeResolvConf()
    File(paths.rootfs, "tmp").mkdirs()
    log.system("Starting ${EngineConfig.START_SCRIPT} (profile ${config.profile ?: "remembered"})")
    val p = ProotCommand.processBuilder(paths, config, ProotCommand.launcher()).start()
    process = p
    acquireWakeLock()
    EngineState.update { it.copy(pid = p.pidCompat(), startedAtMs = System.currentTimeMillis()) }

    val reader = launch {
      runCatching {
        p.inputStream.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            log.append(line)
            when {
              line.startsWith("OPENBOT_LOCAL_READY") -> markRunning(line)
              line.startsWith("OPENBOT_LOCAL_FAILED") ->
                EngineState.update { it.copy(message = line.removePrefix("OPENBOT_LOCAL_FAILED").trim()) }
            }
          }
        }
      }
    }
    val readiness = launch { watchStateFile(p) }
    try {
      runInterruptible { p.waitFor() }
    } finally {
      withContext(NonCancellable) {
        readiness.cancel()
        if (p.isAliveCompat()) gracefulStopBlocking(p, config.stopTimeoutMs)
        withTimeoutOrNull(2000) { reader.join() }
        process = null
      }
    }
  }

  /**
   * Mirrors `engine.state` into EngineState, host side, no proot call: once a second while the engine
   * starts, then every 5 s once it is ready (audit L-4: fewer wakeups for the hours it runs). A crash
   * is still caught at once by p.waitFor(), and the stdout reader sees READY / FAILED lines live.
   */
  private suspend fun watchStateFile(p: Process) {
    var lastState: String? = null
    while (p.isAliveCompat()) {
      val s = LauncherState.read(paths.stateFile)
      if (s != null && s.state != lastState) {
        lastState = s.state
        when (s.state) {
          "ready" -> if (s.engineAlive) markRunning("engine.state ready (profile ${s.profile})")
          "starting" -> EngineState.update { it.copy(phase = EnginePhase.STARTING, message = "Starting OpenBot (profile ${s.profile ?: "?"})") }
          "failed" -> EngineState.update { it.copy(message = listOfNotNull(s.reason, s.code?.let { c -> "code $c" }).joinToString(", ")) }
          "stopping" -> EngineState.update { it.copy(phase = EnginePhase.STOPPING) }
        }
      }
      delay(if (lastState == "ready") 5000L else 1000L)
    }
  }

  private fun markRunning(detail: String) {
    if (EngineState.current.phase == EnginePhase.RUNNING) return
    EngineState.update { it.copy(phase = EnginePhase.RUNNING, message = null, nextRestartAtMs = null) }
    log.system("Engine is up: $detail")
  }

  /** A launcher left over from a killed app process blocks the next one (exit 20). Stop it first. */
  private suspend fun reapOrphanLauncher() {
    val s = LauncherState.read(paths.stateFile) ?: return
    val pid = s.enginePid ?: return
    if (s.state == "stopped" || s.state == "failed" || !LauncherState.pidAlive(pid)) return
    log.system("Stopping orphaned launcher pid $pid")
    try {
      Os.kill(pid, OsConstants.SIGTERM)
    } catch (_: ErrnoException) {
      return
    }
    val deadline = SystemClock.elapsedRealtime() + EngineConfig.load(this).stopTimeoutMs
    while (LauncherState.pidAlive(pid) && SystemClock.elapsedRealtime() < deadline) delay(250)
  }

  /** README-ENGINE.md, DNS: the device's resolvers into $R/etc/resolv.conf, before each start. */
  private fun writeResolvConf() {
    try {
      val cm = getSystemService(ConnectivityManager::class.java) ?: return
      val servers = cm.getLinkProperties(cm.activeNetwork)?.dnsServers
        ?.mapNotNull { it.hostAddress?.substringBefore('%') }
        .orEmpty()
      if (servers.isEmpty()) return
      val file = File(paths.rootfs, "etc/resolv.conf")
      if (NativeFs.isSymlink(file)) NativeFs.deleteTree(file)
      file.writeText((servers + listOf("1.1.1.1", "8.8.8.8")).distinct().joinToString("") { "nameserver $it\n" })
    } catch (e: Exception) {
      log.system("DNS sync skipped: ${e.message}")
    }
  }

  private fun fail(message: String) {
    EngineState.update { it.copy(phase = EnginePhase.ERROR, message = message, installStep = null, progress = null, pid = null) }
    releaseWakeLock()
    notifyStatus()
  }

  // ---------------------------------------------------------------------------------------------
  // Wake lock
  // ---------------------------------------------------------------------------------------------

  @Synchronized
  private fun acquireWakeLock() {
    val lock = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenBotLocal:engine")
      .also {
        it.setReferenceCounted(false)
        wakeLock = it
      }
    // The timeout caps a leaked lock; each (re)start renews it.
    lock.acquire(WAKE_LOCK_TIMEOUT_MS)
  }

  @Synchronized
  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  // ---------------------------------------------------------------------------------------------
  // Notification
  // ---------------------------------------------------------------------------------------------

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "OpenBot engine", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shows while the local OpenBot engine runs"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun goForeground(): Boolean = try {
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(EngineState.current), type)
    true
  } catch (e: Exception) {
    // Android 12+: ForegroundServiceStartNotAllowedException for a start from the background,
    // e.g. a sticky restart while the app is not visible. The next app open starts it again.
    log.system("Cannot start in the foreground: ${e.message}")
    EngineState.update { it.copy(phase = EnginePhase.STOPPED, message = "Open the app to start the engine") }
    stopSelf()
    false
  }

  private fun notifyStatus() {
    if (stopRequested) return
    try {
      NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification(EngineState.current))
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS denied: the service runs, the notification is hidden.
    }
  }

  private fun buildNotification(status: EngineStatus): Notification {
    val title = when (status.phase) {
      EnginePhase.INSTALLING -> "Installing OpenBot engine"
      EnginePhase.STARTING -> "Starting OpenBot engine"
      EnginePhase.RUNNING -> "OpenBot engine running"
      EnginePhase.STOPPING -> "Stopping OpenBot engine"
      EnginePhase.CRASHED -> "OpenBot engine restarting"
      EnginePhase.ERROR, EnginePhase.UNSUPPORTED -> "OpenBot engine stopped"
      else -> "OpenBot engine"
    }
    val text = status.message ?: status.installedVersion ?: ""
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val stop = PendingIntent.getService(
      this,
      1,
      Intent(this, EngineService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.openbot_engine_notification)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(0, "Stop", stop)
    launch?.let { builder.setContentIntent(it) }
    if (status.phase == EnginePhase.INSTALLING) {
      val p = status.progress
      if (p == null) builder.setProgress(0, 0, true) else builder.setProgress(100, (p * 100).toInt(), false)
    }
    return builder.build()
  }
}
