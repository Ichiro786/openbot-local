package run.openbot.engine

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

  private fun write(context: Context, thread: Thread, error: Throwable) {
    val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
    val time = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      .apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(Date())
    val version = try {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      "${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else 0})"
    } catch (_: Throwable) {
      "unknown"
    }
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
