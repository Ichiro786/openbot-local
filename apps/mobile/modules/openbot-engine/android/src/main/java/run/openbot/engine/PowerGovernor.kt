package run.openbot.engine

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.FileObserver
import android.os.PowerManager
import android.os.Process
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/**
 * Battery and heat policy while the engine runs (Build 17; Hermes Local's PowerGovernor, adapted).
 *
 * The phone may sleep unless something needs the engine. The partial wake lock is held only:
 *  - while agents work: engine patch 0005 writes `working=<n>` to `$R/run/openbot/busy` when the count
 *    changes; a FileObserver (inotify, no polling) reads it, plus a [TAIL_MS] tail after the last turn;
 *  - while the engine starts (installing and booting is work too);
 *  - while the app is on screen, plus the same tail after it leaves;
 *  - always, with "Always on" in Settings > Local engine (the behaviour before build 17), and always for
 *    an engine without patch 0005 (no busy file once it is ready).
 * The engine is a foreground service either way; without the lock, messages that arrive while the phone
 * sleeps (WhatsApp, routines) wait for the next wake.
 *
 * Priority and heat: with the screen off every engine thread runs at nice 10, and back at 0 with the screen
 * on (best effort: Android may refuse to raise a priority again; then it stays 10 until the next start).
 * From thermal MODERATE the threads are niced to 10 until the next start; from SEVERE an idle engine is
 * stopped ([onTooHot]); a turn in progress may finish first.
 */
class PowerGovernor(
  private val context: Context,
  private val scope: CoroutineScope,
  private val paths: EnginePaths,
  private val log: EngineLog,
  private val onTooHot: () -> Unit,
) {
  private val pm = context.getSystemService(PowerManager::class.java)
  private var wakeLock: PowerManager.WakeLock? = null
  private var job: Job? = null
  @Volatile private var keepAwake = false
  @Volatile private var working = 0
  @Volatile private var busySeen = false
  @Volatile private var starting = true
  @Volatile private var activeUntil = 0L
  @Volatile private var visible = false
  @Volatile private var screenOn = true
  @Volatile private var thermal = PowerManager.THERMAL_STATUS_NONE
  @Volatile private var hotNice = false
  private var observer: FileObserver? = null

  private val thermalListener = if (Build.VERSION.SDK_INT >= 29) PowerManager.OnThermalStatusChangedListener { status ->
    onThermal(status)
  } else null

  private fun onThermal(status: Int) {
    thermal = status
    if (status >= PowerManager.THERMAL_STATUS_MODERATE && !hotNice) {
      hotNice = true
      log.system("Phone is warm (thermal status $status): engine threads at nice 10 until the next start")
      scope.launch { renice(NICE_BACKGROUND) }
    }
    checkHeat()
  }

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      screenOn = intent.action != Intent.ACTION_SCREEN_OFF
      scope.launch { renice(if (screenOn && !hotNice) NICE_DEFAULT else NICE_BACKGROUND) }
    }
  }

  private val activities = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) = onVisibilityMaybeChanged()
    override fun onActivityStopped(activity: Activity) = onVisibilityMaybeChanged()
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
  }

  /** At each engine start. Holds the lock until the engine is ready and the busy file says otherwise. */
  fun start(config: EngineConfig) {
    keepAwake = config.keepAwake
    active = this
    starting = true
    working = 0
    busySeen = false
    hotNice = false
    activeUntil = 0L
    visible = appVisible()
    screenOn = pm.isInteractive
    if (job == null) {
      if (Build.VERSION.SDK_INT >= 29 && thermalListener != null) {
        runCatching { pm.addThermalStatusListener(context.mainExecutor, thermalListener) }
      }
      val filter = IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
      }
      if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      else context.registerReceiver(screenReceiver, filter)
      (context.applicationContext as Application).registerActivityLifecycleCallbacks(activities)
      job = scope.launch {
        while (isActive) {
          apply()
          delay(RENEW_MS)
        }
      }
    }
    watchBusyFile()
    apply()
  }

  /** The engine answered: from now on the busy file (or its absence) decides. */
  fun onReady() {
    starting = false
    activeUntil = System.currentTimeMillis() + TAIL_MS
    // A new launch starts its processes at nice 0: put them back where the screen and heat say.
    if (!screenOn || hotNice) scope.launch { renice(NICE_BACKGROUND) }
    apply()
  }

  /** The engine stopped (for good or until a restart). */
  fun stop() {
    if (active === this) active = null
    job?.cancel()
    job = null
    observer?.stopWatching()
    observer = null
    if (Build.VERSION.SDK_INT >= 29 && thermalListener != null) runCatching { pm.removeThermalStatusListener(thermalListener) }
    runCatching { context.unregisterReceiver(screenReceiver) }
    runCatching { (context.applicationContext as Application).unregisterActivityLifecycleCallbacks(activities) }
    release()
    EngineState.update { it.copy(awake = null) }
  }

  fun isWorking(): Boolean = working > 0

  private fun onVisibilityMaybeChanged() {
    // The process importance changes a moment after onStart/onStop.
    scope.launch {
      delay(500)
      val now = appVisible()
      if (now != visible) {
        visible = now
        if (!now) activeUntil = maxOf(activeUntil, System.currentTimeMillis() + TAIL_MS)
        apply()
      }
    }
  }

  private fun appVisible(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    // FOREGROUND (100) only: this process also hosts the engine's foreground service, which alone ranks it
    // FOREGROUND_SERVICE (125), inside VISIBLE (200). With VISIBLE the app would count as open forever.
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun watchBusyFile() {
    observer?.stopWatching()
    val dir = File(paths.rootfs, "run/openbot")
    dir.mkdirs()
    val busy = File(dir, "busy")
    readBusy(busy)
    @Suppress("DEPRECATION") // FileObserver(File, Int) is API 29+; minSdk is lower.
    observer = object : FileObserver(dir.path, FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.DELETE) {
      override fun onEvent(event: Int, path: String?) {
        if (path == "busy") {
          readBusy(busy)
          apply()
        }
      }
    }.also { it.startWatching() }
  }

  private fun readBusy(file: File) {
    val text = runCatching { file.readText() }.getOrNull() ?: return
    val n = Regex("working=(\\d+)").find(text)?.groupValues?.get(1)?.toIntOrNull() ?: return
    busySeen = true
    val was = working
    working = n
    if (n == 0 && was > 0) activeUntil = System.currentTimeMillis() + TAIL_MS
    checkHeat()
  }

  private fun checkHeat() {
    if (thermal >= PowerManager.THERMAL_STATUS_SEVERE && working == 0 && System.currentTimeMillis() > activeUntil) {
      log.system("Phone is too hot (thermal status $thermal) and no agent works: stopping the engine")
      onTooHot()
    }
  }

  @SuppressLint("WakelockTimeout")
  @Synchronized
  private fun apply() {
    val now = System.currentTimeMillis()
    val reason = when {
      keepAwake -> "Always on"
      starting -> "Starting"
      working > 0 -> "Working"
      !busySeen -> "Always on (engine without busy reports)"
      visible -> "App open"
      now < activeUntil -> "Finishing"
      else -> null
    }
    if (reason != null) {
      val lock = wakeLock ?: pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenBotLocal:engine").also {
        it.setReferenceCounted(false)
        wakeLock = it
      }
      // Renewed every RENEW_MS while a reason holds, so a lock can never outlive this loop by long.
      lock.acquire(RENEW_MS * 3)
    } else {
      release()
    }
    if (EngineState.current.awake != reason) {
      EngineState.update { it.copy(awake = reason) }
      log.system("Wake lock: ${reason ?: "released (the phone may sleep)"}")
    }
  }

  @Synchronized
  private fun release() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  /** Every thread of every process of this app except this one (the UI and service): proot and the guests. */
  private fun renice(nice: Int) {
    val me = Process.myPid().toString()
    var changed = 0
    var refused = 0
    File("/proc").list()?.forEach { pid ->
      if (pid == me || pid.firstOrNull()?.isDigit() != true) return@forEach
      File("/proc/$pid/task").list()?.forEach { tid ->
        try {
          Process.setThreadPriority(tid.toInt(), nice)
          changed++
        } catch (_: Exception) {
          refused++
        }
      }
    }
    log.system("Engine threads at nice $nice: $changed set" + if (refused > 0) ", $refused refused" else "")
  }

  companion object {
    @Volatile private var active: PowerGovernor? = null

    /** The "Always on" switch changed in Settings: the running engine follows it at once. */
    fun keepAwakeChanged(on: Boolean) {
      active?.let {
        it.keepAwake = on
        it.apply()
      }
    }

    const val TAIL_MS = 60_000L
    const val RENEW_MS = 10_000L
    const val NICE_DEFAULT = 0
    const val NICE_BACKGROUND = 10
  }
}
