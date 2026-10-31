package run.openbot.engine

import android.net.LocalSocket
import android.net.LocalSocketAddress
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.URLEncoder

/**
 * HTTP/1.0 over OpenBot's control socket (`$R/run/openbot/control.sock`, a real host Unix socket
 * owned by the app uid, mode 0600). Answers are `key=value` lines; request bodies are
 * application/x-www-form-urlencoded, at most 4 KiB. These are the routes the upstream CLI uses:
 * GET /v1/status, POST /v1/login/start, /v1/login/verify, /v1/login/claim, /v1/name,
 * /v1/mobile-connect, /v1/logout.
 */
class ControlSocket(private val socketFile: File) {
  data class Response(val status: Int, val body: String) {
    val fields: Map<String, String> get() = KeyValue.parse(body)
    val ok: Boolean get() = status in 200..299
  }

  class ControlSocketException(message: String, cause: Throwable? = null) : IOException(message, cause)

  fun request(method: String, path: String, form: Map<String, String> = emptyMap(), timeoutMs: Int = 15_000): Response {
    val socketPath = socketFile.absolutePath
    if (socketPath.toByteArray().size > EnginePaths.MAX_SOCKET_PATH) {
      throw ControlSocketException("Control socket path is ${socketPath.length} bytes, over the 108-byte limit: $socketPath")
    }
    if (!socketFile.exists()) throw ControlSocketException("The engine is not running (no control socket)")
    val body = form.entries.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }.toByteArray(Charsets.UTF_8)
    if (body.size > 4096) throw ControlSocketException("Request body over 4 KiB")

    val socket = LocalSocket()
    try {
      socket.connect(LocalSocketAddress(socketPath, LocalSocketAddress.Namespace.FILESYSTEM))
      socket.soTimeout = timeoutMs
      val head = buildString {
        append("$method $path HTTP/1.0\r\n")
        append("Host: openbot\r\n")
        append("Connection: close\r\n")
        if (method != "GET") {
          append("Content-Type: application/x-www-form-urlencoded\r\n")
          append("Content-Length: ${body.size}\r\n")
        }
        append("\r\n")
      }
      val out = socket.outputStream
      out.write(head.toByteArray(Charsets.US_ASCII))
      if (method != "GET") out.write(body)
      out.flush()
      // HTTP/1.0 + Connection: close: the server closes after the answer, so read to EOF.
      val raw = ByteArrayOutputStream()
      socket.inputStream.copyTo(raw)
      return parse(raw.toString(Charsets.UTF_8.name()))
    } catch (e: IOException) {
      if (e is ControlSocketException) throw e
      throw ControlSocketException("Control socket: ${e.message}", e)
    } finally {
      try {
        socket.close()
      } catch (_: IOException) {
      }
    }
  }

  fun status(): Response = request("GET", "/v1/status", timeoutMs = 3000)

  private fun parse(raw: String): Response {
    val split = raw.indexOf("\r\n\r\n").takeIf { it >= 0 }?.let { it to 4 }
      ?: raw.indexOf("\n\n").takeIf { it >= 0 }?.let { it to 2 }
      ?: throw ControlSocketException("Malformed answer from the control socket")
    val statusLine = raw.substring(0, raw.indexOfAny(charArrayOf('\r', '\n')).coerceAtLeast(0))
    val status = statusLine.split(' ').getOrNull(1)?.toIntOrNull()
      ?: throw ControlSocketException("Malformed status line: $statusLine")
    return Response(status, raw.substring(split.first + split.second))
  }

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}
