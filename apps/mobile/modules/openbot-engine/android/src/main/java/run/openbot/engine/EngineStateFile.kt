package run.openbot.engine

import android.system.ErrnoException
import android.system.Os
import java.io.File

/**
 * `$R/run/openbot/engine.state`, written by the launcher:
 * ```
 * state=starting|ready|stopping|stopped|failed
 * reason=...
 * code=<exit code on failure>
 * profile=safe
 * engine_pid=<launcher pid>
 * openbot_pid=<pid>
 * updated=<UTC>
 * ```
 * proot does not virtualise pids, so the pids are real host pids the app may signal.
 */
data class LauncherState(
  val state: String?,
  val reason: String?,
  val code: Int?,
  val profile: String?,
  val enginePid: Int?,
  val openbotPid: Int?,
  val updated: String?,
) {
  val engineAlive: Boolean get() = enginePid?.let { pidAlive(it) } ?: false
  val isReady: Boolean get() = state == "ready" && engineAlive

  companion object {
    fun read(file: File): LauncherState? = try {
      if (!file.exists()) null
      else parse(file.readText())
    } catch (_: Exception) {
      null
    }

    fun parse(text: String): LauncherState {
      val map = KeyValue.parse(text)
      return LauncherState(
        state = map["state"],
        reason = map["reason"],
        code = map["code"]?.toIntOrNull(),
        profile = map["profile"],
        enginePid = map["engine_pid"]?.toIntOrNull(),
        openbotPid = map["openbot_pid"]?.toIntOrNull(),
        updated = map["updated"],
      )
    }

    /** Signal 0 checks existence and permission without sending anything. */
    fun pidAlive(pid: Int): Boolean = try {
      Os.kill(pid, 0)
      true
    } catch (_: ErrnoException) {
      false
    }
  }
}

/** The launcher and the control socket both answer in `key=value` lines. */
object KeyValue {
  fun parse(text: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    text.lineSequence().forEach { line ->
      val i = line.indexOf('=')
      if (i > 0) out[line.substring(0, i).trim()] = line.substring(i + 1).trim()
    }
    return out
  }
}

/** Launcher exit codes (README-ENGINE.md, "Exit codes of openbot-start.sh"). */
object LauncherExit {
  fun describe(code: Int): String = when (code) {
    0 -> "Clean stop"
    2 -> "Launcher usage error"
    10 -> "OpenBot app missing from the engine (incomplete payload)"
    11 -> "/proc, /dev or /tmp unusable, or the log is not writable"
    12 -> "dbus-daemon failed"
    13 -> "Xvfb failed"
    14 -> "Keyring / Secret Service failed"
    15 -> "OpenBot exited before it was ready"
    16 -> "OpenBot was not ready in time"
    17 -> "Network service crash loop with no fallback profile left"
    18 -> "OpenBot exited with an error after it was ready"
    20 -> "Another launcher is already running"
    else -> "Engine exited with code $code"
  }

  /** Codes a restart cannot fix: stop and show the error instead of looping. */
  fun isFatal(code: Int): Boolean = code == 2 || code == 10 || code == 11
}
