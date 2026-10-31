package run.openbot.engine

import android.content.Context
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Engine stdout/stderr and supervisor messages. Lines go to `engine/logs/engine.log`, which rotates
 * at [maxBytes] into engine.log.1 .. engine.log.[keep], and to an in-memory ring for `getLogTail`.
 */
class EngineLog private constructor(
  private val dir: File,
  private val maxBytes: Long = 2L * 1024 * 1024,
  private val keep: Int = 3,
  private val ringSize: Int = 2000,
) {
  private val ring = ArrayDeque<String>(ringSize)
  private var writer: FileWriter? = null
  private var written = 0L
  private val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)

  private val current: File get() = File(dir, "engine.log")

  @Synchronized
  fun append(line: String, source: String = "engine") {
    val stamped = "${stamp.format(Date())} [$source] $line"
    if (ring.size >= ringSize) ring.removeFirst()
    ring.addLast(stamped)
    try {
      val w = writer ?: open()
      w.write(stamped)
      w.write("\n")
      w.flush()
      written += stamped.length + 1
      if (written >= maxBytes) rotate()
    } catch (_: Exception) {
      // Logging never takes the engine down.
      writer = null
    }
  }

  fun system(line: String) = append(line, "supervisor")

  @Synchronized
  fun tail(n: Int): List<String> {
    val count = n.coerceIn(1, ringSize)
    if (ring.isNotEmpty()) return ring.toList().takeLast(count)
    // After a process restart the ring is empty; read the file instead.
    return try {
      current.takeIf { it.exists() }?.readLines()?.takeLast(count) ?: emptyList()
    } catch (_: Exception) {
      emptyList()
    }
  }

  @Synchronized
  fun clear() {
    ring.clear()
    writer?.close()
    writer = null
    (0..keep).forEach { File(dir, if (it == 0) "engine.log" else "engine.log.$it").delete() }
    written = 0
  }

  private fun open(): FileWriter {
    dir.mkdirs()
    written = current.length()
    return FileWriter(current, true).also { writer = it }
  }

  private fun rotate() {
    writer?.close()
    writer = null
    for (i in keep downTo 1) {
      val from = File(dir, if (i == 1) "engine.log" else "engine.log.${i - 1}")
      val to = File(dir, "engine.log.$i")
      if (from.exists()) {
        to.delete()
        from.renameTo(to)
      }
    }
    written = 0
  }

  companion object {
    @Volatile private var instance: EngineLog? = null

    fun get(context: Context): EngineLog =
      instance ?: synchronized(this) {
        instance ?: EngineLog(EnginePaths(context).logs).also { instance = it }
      }
  }
}
