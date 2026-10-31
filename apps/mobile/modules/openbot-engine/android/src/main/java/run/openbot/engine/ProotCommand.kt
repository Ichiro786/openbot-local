package run.openbot.engine

import java.io.File

/**
 * The proot command line from rootfs/README-ENGINE.md ("Starting it: the proot command"), kept in
 * the same order:
 *
 * ```
 * $L/libproot.so --kill-on-exit --link2symlink --sysvipc -0 -L -r "$R" -w /root \
 *   -b /dev -b /proc -b /sys -b /dev/urandom:/dev/random -b /proc/self/fd:/dev/fd \
 *   -b /proc/self/fd/0:/dev/stdin -b /proc/self/fd/1:/dev/stdout -b /proc/self/fd/2:/dev/stderr \
 *   -b "$R/tmp:/dev/shm" \
 *   -b "$R/opt/openbot-local/proc/max_user_watches:/proc/sys/fs/inotify/max_user_watches" \
 *   -b "$R/opt/openbot-local/proc/cap_last_cap:/proc/sys/kernel/cap_last_cap" \
 *   [-b "$R/opt/openbot-local/proc/<loadavg|stat|uptime|version|vmstat>:/proc/<same>"]  # only when unreadable
 *   /usr/bin/env -i HOME=/root USER=root TERM=xterm-256color LANG=C.UTF-8 TMPDIR=/tmp \
 *     PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin OPENBOT_PROOT_PROFILE=safe \
 *     /bin/bash /root/openbot-start.sh
 * ```
 * Host env: PROOT_TMP_DIR=$cacheDir/proot, PROOT_LOADER=$L/libproot-loader.so, LD_LIBRARY_PATH=$L,
 * no LD_PRELOAD, optional PROOT_NO_SECCOMP=1.
 *
 * Why nativeLibraryDir: since targetSdk 29 an app may not execve files it can write (W^X). The
 * package manager extracts lib*.so to nativeLibraryDir (exec allowed) when legacy packaging is on;
 * proot then routes every guest execve through PROOT_LOADER, so guest binaries in filesDir never
 * need exec permission themselves.
 */
object ProotCommand {
  const val GUEST_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

  /** Always bound: apps cannot read the real ones. */
  private val ALWAYS_FAKE = listOf(
    "max_user_watches" to "/proc/sys/fs/inotify/max_user_watches",
    "cap_last_cap" to "/proc/sys/kernel/cap_last_cap",
  )

  /** Bound only when the real file is unreadable (SELinux on most Android 8+ builds). */
  private val FAKE_IF_UNREADABLE = listOf("loadavg", "stat", "uptime", "version", "vmstat")

  fun guestEnv(config: EngineConfig, extra: Map<String, String> = emptyMap()): Map<String, String> {
    val env = linkedMapOf(
      "HOME" to "/root",
      "USER" to "root",
      "TERM" to "xterm-256color",
      "LANG" to "C.UTF-8",
      "TMPDIR" to "/tmp",
      "PATH" to GUEST_PATH,
    )
    config.profile?.let { env["OPENBOT_PROOT_PROFILE"] = it }
    env.putAll(config.guestEnv)
    env.putAll(extra)
    return env
  }

  /** argv running [guestArgv] in the rootfs. */
  fun argv(paths: EnginePaths, guestArgv: List<String>, guestEnv: Map<String, String>): List<String> {
    val r = paths.rootfs.absolutePath
    val args = mutableListOf(
      paths.proot.absolutePath,
      "--kill-on-exit",
      "--link2symlink",
      "--sysvipc",
      "-0",
      "-L",
      "-r", r,
      "-w", "/root",
      "-b", "/dev",
      "-b", "/proc",
      "-b", "/sys",
      "-b", "/dev/urandom:/dev/random",
      "-b", "/proc/self/fd:/dev/fd",
      "-b", "/proc/self/fd/0:/dev/stdin",
      "-b", "/proc/self/fd/1:/dev/stdout",
      "-b", "/proc/self/fd/2:/dev/stderr",
      "-b", "$r/tmp:/dev/shm",
    )
    val fakes = File(paths.rootfs, "opt/openbot-local/proc")
    for ((name, guest) in ALWAYS_FAKE) {
      val fake = File(fakes, name)
      if (fake.isFile) args += listOf("-b", "${fake.absolutePath}:$guest")
    }
    for (name in FAKE_IF_UNREADABLE) {
      val fake = File(fakes, name)
      if (fake.isFile && !hostProcReadable(name)) args += listOf("-b", "${fake.absolutePath}:/proc/$name")
    }
    args += listOf("/usr/bin/env", "-i")
    guestEnv.forEach { (k, v) -> args += "$k=$v" }
    args += guestArgv
    return args
  }

  /** `File.canRead()` alone lies under SELinux; also try to read a byte. */
  private fun hostProcReadable(name: String): Boolean {
    val f = File("/proc/$name")
    if (!f.canRead()) return false
    return try {
      f.inputStream().use { it.read() >= 0 }
    } catch (_: Exception) {
      false
    }
  }

  /** Clean host environment for the proot process. Engine overrides go through env -i, never here. */
  fun hostEnv(paths: EnginePaths, config: EngineConfig, inherited: Map<String, String>): Map<String, String> {
    val env = HashMap<String, String>()
    // What bionic/the shell may need; nothing app-specific, no LD_PRELOAD.
    listOf("ANDROID_ROOT", "ANDROID_DATA", "ANDROID_RUNTIME_ROOT", "ANDROID_ART_ROOT", "ANDROID_I18N_ROOT", "ANDROID_TZDATA_ROOT")
      .forEach { key -> inherited[key]?.let { env[key] = it } }
    env["PATH"] = "/system/bin:/system/xbin"
    env["PROOT_TMP_DIR"] = paths.prootTmp.absolutePath
    env["PROOT_LOADER"] = paths.loader.absolutePath
    // libtalloc.so (soname patched from libtalloc.so.2) and libandroid-shmem.so.
    env["LD_LIBRARY_PATH"] = paths.nativeLibDir.absolutePath
    if (config.noSeccomp) env["PROOT_NO_SECCOMP"] = "1"
    return env
  }

  fun processBuilder(
    paths: EnginePaths,
    config: EngineConfig,
    guestArgv: List<String>,
    extraGuestEnv: Map<String, String> = emptyMap(),
    mergeStderr: Boolean = true,
  ): ProcessBuilder {
    paths.ensureDirs()
    val pb = ProcessBuilder(argv(paths, guestArgv, guestEnv(config, extraGuestEnv)))
      .directory(paths.rootfs)
      .redirectErrorStream(mergeStderr)
    val env = pb.environment()
    val inherited = HashMap(env)
    env.clear()
    env.putAll(hostEnv(paths, config, inherited))
    return pb
  }

  /** The launcher command: `/bin/bash /root/openbot-start.sh [args]`. */
  fun launcher(vararg args: String): List<String> = listOf("/bin/bash", EngineConfig.START_SCRIPT) + args

  /** Why proot cannot start, or null when everything it needs is in place. */
  fun preflight(paths: EnginePaths): String? {
    val socket = paths.controlSocket.absolutePath
    return when {
      !paths.proot.exists() -> "libproot.so missing from ${paths.nativeLibDir} (legacy packaging off, or fetch-proot.sh not run)"
      !paths.loader.exists() -> "libproot-loader.so missing from ${paths.nativeLibDir}"
      !File(paths.nativeLibDir, "libtalloc.so").exists() -> "libtalloc.so missing from ${paths.nativeLibDir}"
      !File(paths.nativeLibDir, "libandroid-shmem.so").exists() -> "libandroid-shmem.so missing from ${paths.nativeLibDir}"
      socket.toByteArray().size > EnginePaths.MAX_SOCKET_PATH -> "Rootfs path too long for Unix sockets: $socket"
      else -> null
    }
  }
}
