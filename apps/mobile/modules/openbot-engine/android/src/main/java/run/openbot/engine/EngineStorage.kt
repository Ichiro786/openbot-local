package run.openbot.engine

import android.app.usage.StorageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import android.os.storage.StorageManager
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.RandomAccessFile

class EngineStorageException(message: String) : expo.modules.kotlin.exception.CodedException(message)

/**
 * Settings › Local engine › Storage: what the app's private storage holds, and safe cleanups.
 *
 * The scan walks with lstat only (never follows a symlink: a rootfs is full of absolute links that
 * point at the HOST from outside proot), counts allocated blocks like `du`, skips what it may not
 * read, and stops at [SCAN_BUDGET_MS] (the result then says `complete=false`).
 *
 * Cleanups never touch the active rootfs system files, /root's workspaces, OpenBot's data, the
 * keyring or credentials. Each one re-checks its own guard here, whatever the UI showed:
 *  - previous: r.prev only once the current engine is up and confirmed (or r.prev is an orphan
 *    with no previous.json, which rollback cannot use);
 *  - partial / downloads: only while no install holds [diskLock] and the phase is not installing;
 *  - packageCaches: inside the rootfs through [CommandRunner] (a guest `rm`, so proot's view of the
 *    files is used), only npm's content cache and pip/node-gyp/yarn caches, never caches that hold
 *    tools being run (npx, bunx, uv);
 *  - logs: rotated files go, an oversized live /root/openbot.log keeps its last [LOG_KEEP_BYTES];
 *  - appCache: the app's cache folder, except proot's tmp and the composer's pending pictures.
 */
object EngineStorage {
  /** Held by an engine install for its whole run, and by every cleanup that deletes engine files. */
  val diskLock = Mutex()
  private val scanLock = Mutex()

  private const val SCAN_BUDGET_MS = 45_000L
  private const val LOG_KEEP_BYTES = 512L * 1024
  private const val LIVE_LOG_TRIM_AT = 8L * 1024 * 1024

  /** Under /root: cleanable package caches. Kept to caches nothing runs out of. */
  val PACKAGE_CACHES = listOf(".npm/_cacache", ".cache/pip", ".cache/node-gyp", ".cache/yarn")
  private const val WORKSPACES = "OpenBot"
  private const val OPENBOT_DATA = ".config/OpenBot"
  private const val ANTIGRAVITY = ".local/share/agy-hybrid"
  private const val HOME_CACHE = ".cache"
  /** Caches tools run from (npx, bunx, uv tools); shown, not cleaned. */
  private val TOOL_CACHES = listOf(".npm/_npx", ".bun/install/cache")
  private val ROOT_LOGS = listOf("openbot.log", "openbot.log.1")
  /** In cacheDir: kept by the app-cache cleanup. */
  private val KEEP_IN_CACHE = setOf("proot", "composer-images")

  private class Walk(private val deadline: Long, private val onProgress: (Long, Long) -> Unit) {
    var files = 0L
    var bytes = 0L
    var timedOut = false
    var nodeModules = 0L
    private var lastReport = 0L

    /** Allocated bytes under [root], skipping [exclude] (absolute paths). */
    fun size(root: File, exclude: Set<String> = emptySet()): Long {
      var total = 0L
      val stack = ArrayDeque<Pair<String, Boolean>>()
      stack.addLast(root.path to false)
      while (stack.isNotEmpty()) {
        if (timedOut) break
        val (path, inNodeModules) = stack.removeLast()
        if (path in exclude) continue
        val st = try {
          Os.lstat(path)
        } catch (_: ErrnoException) {
          continue
        }
        val used = st.st_blocks * 512
        total += used
        bytes += used
        files++
        if (inNodeModules) nodeModules += used
        if (OsConstants.S_ISDIR(st.st_mode)) {
          val names = try {
            File(path).list()
          } catch (_: SecurityException) {
            null
          } ?: continue
          for (name in names) stack.addLast("$path/$name" to (inNodeModules || name == "node_modules"))
        }
        if ((files and 0x3FFL) == 0L) {
          val now = SystemClock.elapsedRealtime()
          if (now > deadline) timedOut = true
          if (now - lastReport > 250) {
            lastReport = now
            onProgress(files, bytes)
          }
        }
      }
      return total
    }
  }

  private fun exists(file: File) = NativeFs.exists(file)

  /** Whether r.prev may go now: the engine that replaced it is up and confirmed, or nothing can use it. */
  private fun previousRemovable(paths: EnginePaths, lockHeld: Boolean = false): Boolean {
    if (!exists(paths.previous)) return false
    if (if (lockHeld) EngineState.current.phase == EnginePhase.INSTALLING else installing()) return false
    if (!paths.previousJson.exists()) return true // an orphan: rollback needs previous.json
    val status = EngineState.current
    val ready = LauncherState.read(paths.stateFile)?.isReady == true
    return status.phase == EnginePhase.RUNNING && ready && !status.updatePendingConfirm
  }

  private fun installing(): Boolean =
    diskLock.isLocked || EngineState.current.phase == EnginePhase.INSTALLING

  suspend fun scan(context: Context, onProgress: (Long, Long) -> Unit): Map<String, Any?> = scanLock.withLock {
    withContext(Dispatchers.IO) { scanNow(context, onProgress) }
  }

  private fun scanNow(context: Context, onProgress: (Long, Long) -> Unit): Map<String, Any?> {
    val app = context.applicationContext
    val paths = EnginePaths(app)
    val config = EngineConfig.load(app)
    val started = SystemClock.elapsedRealtime()
    val walk = Walk(started + SCAN_BUDGET_MS, onProgress)
    val sizes = LinkedHashMap<String, Long>()
    fun add(key: String, value: Long) {
      sizes[key] = (sizes[key] ?: 0L) + value
    }

    // Installed rootfs: system files vs the carried user paths (/root by default).
    val rootfs = paths.rootfs
    val home = File(rootfs, "root")
    val carried = config.persistPaths.map { File(rootfs, it.trim('/')).path }.toSet() + home.path
    if (exists(rootfs)) {
      add("engineSystem", walk.size(rootfs, carried))
      for (path in carried) if (path != home.path) add("otherUserData", walk.size(File(path)))

      val known = LinkedHashMap<String, File>()
      known["workspaces"] = File(home, WORKSPACES)
      known["openbotData"] = File(home, OPENBOT_DATA)
      known["antigravity"] = File(home, ANTIGRAVITY)
      for (key in listOf("workspaces", "openbotData", "antigravity")) {
        val before = walk.nodeModules
        add(key, walk.size(known.getValue(key)))
        if (key == "workspaces") add("nodeModules", walk.nodeModules - before)
      }
      val packageDirs = PACKAGE_CACHES.map { File(home, it) }
      add("packageCaches", packageDirs.sumOf { walk.size(it) })
      val toolDirs = TOOL_CACHES.map { File(home, it) }
      add("toolCaches", toolDirs.sumOf { walk.size(it) })
      val cacheExclude = (packageDirs + toolDirs).map { it.path }.toSet()
      add("otherCaches", walk.size(File(home, HOME_CACHE), cacheExclude))
      val logFiles = ROOT_LOGS.map { File(home, it) }
      add("logs", logFiles.sumOf { walk.size(it) })
      val homeExclude = (known.values + packageDirs + toolDirs + logFiles + File(home, HOME_CACHE)).map { it.path }.toSet()
      add("otherUserData", walk.size(home, homeExclude))
    }

    add("previous", walk.size(paths.previous))
    add("partial", walk.size(paths.staging) + walk.size(paths.trash))
    val downloadFiles = paths.downloads.list()?.size ?: 0
    add("downloads", walk.size(paths.downloads))
    add("logs", walk.size(paths.logs))

    val cacheDir = app.cacheDir
    add("appCache", walk.size(cacheDir, KEEP_IN_CACHE.map { File(cacheDir, it).path }.toSet()))
    val dataDir = File(app.applicationInfo.dataDir)
    val accounted = setOf(rootfs, paths.previous, paths.staging, paths.trash, paths.downloads, paths.logs)
      .map { it.path }.toSet() + cacheDir.path
    // Everything else in the app's data (databases, prefs, other files, proot tmp, pending pictures).
    add("other", walk.size(dataDir, accounted) + KEEP_IN_CACHE.sumOf { walk.size(File(cacheDir, it)) })

    val android = androidStats(app)
    val stat = runCatching { StatFs(app.filesDir.path) }.getOrNull()
    val status = EngineState.current
    return mapOf(
      "sizes" to sizes.mapValues { it.value.toDouble() },
      "total" to sizes.filterKeys { it != "nodeModules" }.values.sum().toDouble(),
      "android" to android,
      "deviceFree" to (stat?.availableBytes ?: -1L).toDouble(),
      "deviceTotal" to (stat?.totalBytes ?: -1L).toDouble(),
      "complete" to !walk.timedOut,
      "files" to walk.files.toDouble(),
      "durationMs" to (SystemClock.elapsedRealtime() - started).toDouble(),
      "scannedAtMs" to System.currentTimeMillis().toDouble(),
      "installing" to installing(),
      "engineInstalled" to exists(rootfs),
      "engineRunning" to (status.phase == EnginePhase.RUNNING),
      "updatePendingConfirm" to status.updatePendingConfirm,
      "previousRemovable" to previousRemovable(paths),
      "previousOrphan" to (exists(paths.previous) && !paths.previousJson.exists()),
      "downloadFiles" to downloadFiles,
    )
  }

  /** Android's own App / Data / Cache figures for this package (no permission needed for itself). */
  private fun androidStats(context: Context): Map<String, Double>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return runCatching {
      val manager = context.getSystemService(StorageStatsManager::class.java)
      val stats = manager.queryStatsForPackage(StorageManager.UUID_DEFAULT, context.packageName, Process.myUserHandle())
      mapOf(
        "appBytes" to stats.appBytes.toDouble(),
        "dataBytes" to stats.dataBytes.toDouble(),
        "cacheBytes" to stats.cacheBytes.toDouble(),
      )
    }.getOrNull()
  }

  /** Cleans one category; resolves with the bytes it freed. */
  suspend fun clean(context: Context, category: String): Double = withContext(Dispatchers.IO) {
    val app = context.applicationContext
    val paths = EnginePaths(app)
    val log = EngineLog.get(app)
    val walk = Walk(Long.MAX_VALUE) { _, _ -> }
    if (EngineState.current.phase == EnginePhase.INSTALLING || !diskLock.tryLock()) {
      throw EngineStorageException("An engine install or update is running. Try again when it is done.")
    }
    try {
      val freed = when (category) {
        "previous" -> {
          if (!previousRemovable(paths, lockHeld = true)) {
            throw EngineStorageException("The previous engine is still the rollback for an update that has not started yet.")
          }
          val before = walk.size(paths.previous)
          NativeFs.deleteTree(paths.previous)
          paths.previousJson.delete()
          before
        }
        "partial" -> {
          val before = walk.size(paths.staging) + walk.size(paths.trash)
          NativeFs.deleteTree(paths.staging)
          paths.trash.listFiles()?.forEach { NativeFs.deleteTree(it) }
          before
        }
        "downloads" -> {
          val before = walk.size(paths.downloads)
          paths.downloads.listFiles()?.forEach { NativeFs.deleteTree(it) }
          before
        }
        "logs" -> trimLogs(app, paths, walk)
        "packageCaches" -> cleanPackageCaches(app, paths, walk)
        "appCache" -> {
          val cacheDir = app.cacheDir
          val keep = KEEP_IN_CACHE.map { File(cacheDir, it).path }.toSet()
          val before = walk.size(cacheDir, keep)
          cacheDir.listFiles()?.filter { it.path !in keep }?.forEach { NativeFs.deleteTree(it) }
          before
        }
        else -> throw EngineStorageException("Unknown storage category: $category")
      }
      log.system("Storage: cleaned $category (${freed / (1024 * 1024)} MB)")
      freed.toDouble()
    } finally {
      diskLock.unlock()
    }
  }

  private fun trimLogs(context: Context, paths: EnginePaths, walk: Walk): Long {
    val before = walk.size(paths.logs)
    EngineLog.get(context).deleteRotated()
    var freed = before - walk.size(paths.logs)
    val home = File(paths.rootfs, "root")
    val rotated = File(home, "openbot.log.1")
    if (rotated.isFile && !NativeFs.isSymlink(rotated)) {
      freed += walk.size(rotated)
      rotated.delete()
    }
    // The live log is opened O_APPEND by the launcher and OpenBot: truncating it is safe for them.
    val live = File(home, "openbot.log")
    if (live.isFile && !NativeFs.isSymlink(live) && live.length() > LIVE_LOG_TRIM_AT) {
      val sizeBefore = walk.size(live)
      runCatching {
        RandomAccessFile(live, "rw").use { file ->
          val keep = minOf(LOG_KEEP_BYTES, file.length())
          val tail = ByteArray(keep.toInt())
          file.seek(file.length() - keep)
          file.readFully(tail)
          rotated.writeBytes(tail)
          file.setLength(0)
        }
      }
      freed += sizeBefore - walk.size(live) - walk.size(rotated)
    }
    return freed.coerceAtLeast(0)
  }

  private suspend fun cleanPackageCaches(context: Context, paths: EnginePaths, walk: Walk): Long {
    if (!EngineInstaller(context, paths).isInstalled()) throw EngineStorageException("The engine is not installed.")
    val home = File(paths.rootfs, "root")
    val before = PACKAGE_CACHES.sumOf { walk.size(File(home, it)) }
    // Inside the rootfs, next to a running engine if there is one: a guest rm sees the files as
    // proot does (link2symlink), which a host delete would not.
    val targets = PACKAGE_CACHES.joinToString(" ") { "/root/$it" }
    val result = CommandRunner.run(context, "storage-clean-${System.currentTimeMillis()}", "rm -rf $targets", 120_000) { _, _ -> }
    if (result.exitCode != 0) throw EngineStorageException("Cache cleanup failed (exit ${result.exitCode}): ${result.output.take(200)}")
    return (before - PACKAGE_CACHES.sumOf { walk.size(File(home, it)) }).coerceAtLeast(0)
  }
}
