package run.openbot.engine

import android.content.Context
import java.io.File

/**
 * Engine files. The rootfs sits at `filesDir/r`, deliberately short: the guest's Unix sockets
 * (/run/openbot/control.sock, /run/openbot/bus, /tmp/.X11-unix/X0) are real host sockets at
 * `$R/...`, and a sun_path is capped at 108 bytes. Everything else lives in `filesDir/engine`.
 */
class EnginePaths(context: Context) {
  private val app = context.applicationContext

  /** $R in README-ENGINE.md. */
  val rootfs: File = File(app.filesDir, "r")
  /** Unpack target; renamed to [rootfs] when complete. */
  val staging: File = File(app.filesDir, "r.partial")

  val root: File = File(app.filesDir, "engine")
  val trash: File = File(root, "trash")
  val downloads: File = File(root, "downloads")
  val logs: File = File(root, "logs")
  val installedJson: File = File(root, "installed.json")
  val updateCheckJson: File = File(root, "update-check.json")

  /** PROOT_TMP_DIR: must exist and be writable. */
  val prootTmp: File = File(app.cacheDir, "proot")

  val nativeLibDir: File = File(app.applicationInfo.nativeLibraryDir)
  val proot: File = File(nativeLibDir, "libproot.so")
  val loader: File = File(nativeLibDir, "libproot-loader.so")

  /** Host views of guest files the app reads without entering proot. */
  val stateFile: File get() = File(rootfs, "run/openbot/engine.state")
  val controlSocket: File get() = File(rootfs, "run/openbot/control.sock")
  val engineLog: File get() = File(rootfs, "root/openbot.log")
  val engineVersionFile: File get() = File(rootfs, ".engine-version")

  fun ensureDirs() {
    listOf(root, downloads, logs, trash, prootTmp).forEach { it.mkdirs() }
    File(rootfs, "tmp").takeIf { NativeFs.exists(rootfs) }?.mkdirs()
  }

  fun guestFile(guestPath: String): File = File(rootfs, guestPath.trimStart('/'))

  companion object {
    /** sun_path is 108 bytes including the terminating NUL. */
    const val MAX_SOCKET_PATH = 107
  }
}
