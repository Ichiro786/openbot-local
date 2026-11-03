package run.openbot.engine

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Saves the last uncaught Java/Kotlin exception to `filesDir/openbot-crash-native.txt`, then hands
 * it to the handler that was installed before (so Android still reports the crash). The JS side
 * (`shared/lib/crash-log.ts`) shows the file with a "Copy crash log" button on the next launch.
 * Installing twice is a no-op.
 */
object CrashCapture {
  const val FILE_NAME = "openbot-crash-native.txt"

  @Volatile private var installed = false

  @Synchronized
  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        write(app, thread, error)
      } catch (_: Throwable) {
        // Never throw from inside the crash handler.
      }
      if (previous != null) {
        previous.uncaughtException(thread, error)
      } else {
        android.os.Process.killProcess(android.os.Process.myPid())
        System.exit(10)
      }
    }
  }

  /**
   * A native (C++) crash or an ANR never reaches the Java handler. On the next launch, Android 11+
   * still reports why the last process died: such an exit that is newer than the last one reported
   * is written to the same file. A Java crash is skipped here (the handler above already wrote it).
   * A native tombstone is protobuf, so only its description is kept; an ANR keeps its text trace.
   */
  fun collectLastExit(context: Context) {
    if (Build.VERSION.SDK_INT < 30) return
    try {
      val app = context.applicationContext
      val am = app.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
      val prefs = app.getSharedPreferences("openbot_crash", Context.MODE_PRIVATE)
      val seen = prefs.getLong("last_exit_ts", 0L)
      val exits = am.getHistoricalProcessExitReasons(app.packageName, 0, 5)
      val newest = exits.maxByOrNull { it.timestamp } ?: return
      prefs.edit().putLong("last_exit_ts", maxOf(seen, newest.timestamp)).apply()
      val exit = exits
        .filter { it.timestamp > seen }
        .filter { it.reason == ApplicationExitInfo.REASON_CRASH_NATIVE || it.reason == ApplicationExitInfo.REASON_ANR }
        .maxByOrNull { it.timestamp } ?: return
      if (seen == 0L && System.currentTimeMillis() - exit.timestamp > 24L * 3600 * 1000) return
      val kind = if (exit.reason == ApplicationExitInfo.REASON_ANR) "ANR" else "native crash"
      val trace = if (exit.reason == ApplicationExitInfo.REASON_ANR) {
        try {
          exit.traceInputStream?.use { it.readBytes().decodeToString().take(64_000) }
        } catch (_: Throwable) {
          null
        }
      } else {
        null
      }
      val time = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date(exit.timestamp))
      val text = buildString {
        appendLine("OpenBot crash log ($kind, from Android exit info)")
        appendLine("Time: $time")
        appendLine("App: ${versionOf(app)}")
        appendLine("System: Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("Process: ${exit.processName} status=${exit.status} importance=${exit.importance}")
        appendLine("Description: ${exit.description ?: "(none)"}")
        if (trace != null) {
          appendLine()
          append(trace)
        }
      }
      val file = File(app.filesDir, FILE_NAME)
      // Keep a Java crash that is already waiting to be shown; add the exit info under it.
      if (file.exists()) file.appendText("\n\n----\n\n$text") else file.writeText(text)
    } catch (_: Throwable) {
      // Exit info is best effort.
    }
  }

  private fun versionOf(context: Context): String = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    "${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else 0})"
  } catch (_: Throwable) {
    "unknown"
  }

  private fun write(context: Context, thread: Thread, error: Throwable) {
    val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
    val time = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      .apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(Date())
    val version = versionOf(context)
    val text = buildString {
      appendLine("OpenBot crash log (native)")
      appendLine("Time: $time")
      appendLine("App: $version")
      appendLine("System: Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
      appendLine("Thread: ${thread.name}")
      appendLine()
      append(stack)
    }
    File(context.filesDir, FILE_NAME).writeText(text)
  }
}
