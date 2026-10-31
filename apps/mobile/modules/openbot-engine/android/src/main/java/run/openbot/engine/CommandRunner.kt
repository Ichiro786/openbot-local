package run.openbot.engine

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.InputStreamReader
import java.util.concurrent.ConcurrentHashMap

/**
 * One-off commands inside the rootfs, next to the long-running engine (proot instances can share
 * a rootfs). Output streams in chunks, not lines, so prompts without a trailing newline (device
 * codes, "Press Enter") reach JS immediately. stdin stays open for [write].
 */
object CommandRunner {
  data class Result(val exitCode: Int?, val output: String, val timedOut: Boolean, val cancelled: Boolean)

  private val running = ConcurrentHashMap<String, Process>()
  private val cancelledIds: MutableSet<String> = ConcurrentHashMap.newKeySet()
  private const val MAX_CAPTURE = 256 * 1024

  suspend fun run(
    context: Context,
    id: String,
    command: String,
    timeoutMs: Long?,
    onOutput: (stream: String, chunk: String) -> Unit,
  ): Result = withContext(Dispatchers.IO) {
    val paths = EnginePaths(context)
    val config = EngineConfig.load(context)
    ProotCommand.preflight(paths)?.let { throw IllegalStateException(it) }
    if (!EngineInstaller(context, paths, config).isInstalled()) throw IllegalStateException("The engine is not installed yet")
    if (running.containsKey(id)) throw IllegalArgumentException("A command with id $id is already running")

    val log = EngineLog.get(context)
    log.system("run[$id]: $command")
    val process = ProotCommand.processBuilder(
      paths,
      config,
      guestArgv = listOf("/bin/sh", "-c", command),
      mergeStderr = false,
    ).start()
    running[id] = process
    val captured = StringBuilder()
    var cancelled = false

    fun pump(stream: String, input: java.io.InputStream) {
      InputStreamReader(input, Charsets.UTF_8).use { reader ->
        val buffer = CharArray(4096)
        while (true) {
          val read = reader.read(buffer)
          if (read < 0) break
          val chunk = String(buffer, 0, read)
          synchronized(captured) {
            if (captured.length < MAX_CAPTURE) captured.append(chunk)
          }
          onOutput(stream, chunk)
        }
      }
    }

    try {
      val exit = withTimeoutOrNull(timeoutMs?.takeIf { it > 0 } ?: Long.MAX_VALUE) {
        coroutineScope {
          launch(Dispatchers.IO) { runCatching { pump("stdout", process.inputStream) } }
          launch(Dispatchers.IO) { runCatching { pump("stderr", process.errorStream) } }
          runInterruptible { process.waitFor() }
        }
      }
      cancelled = cancelledIds.remove(id)
      val output = synchronized(captured) { captured.toString() }
      val timedOut = exit == null && !cancelled
      log.system("run[$id]: ${if (cancelled) "cancelled" else if (timedOut) "timed out" else "exit $exit"}")
      Result(if (cancelled) null else exit, output, timedOut = timedOut, cancelled = cancelled)
    } finally {
      withContext(NonCancellable) {
        running.remove(id)
        if (process.isAliveCompat()) process.terminate(1500)
      }
    }
  }

  fun write(id: String, text: String): Boolean {
    val process = running[id] ?: return false
    return try {
      process.outputStream.write(text.toByteArray(Charsets.UTF_8))
      process.outputStream.flush()
      true
    } catch (_: Exception) {
      false
    }
  }

  fun cancel(id: String): Boolean {
    val process = running[id] ?: return false
    cancelledIds.add(id)
    Thread { process.terminate(1500) }.start()
    return true
  }

  fun cancelAll() {
    running.keys.toList().forEach { cancel(it) }
  }
}
