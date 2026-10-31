package run.openbot.engine

import android.content.Context
import android.content.res.AssetManager
import android.os.StatFs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** A payload that can be installed, from the APK or from the network. */
data class EngineRelease(
  val tag: String,
  val source: String, // "bundled" | "remote"
  val url: String?,
  /** True when [url] is a GitHub API asset URL that needs `Accept: application/octet-stream` + token. */
  val apiAsset: Boolean,
  val sha256: String?,
  val sha256Url: String?,
  val size: Long,
  val installedBytes: Long,
  /** engine.json as published, written to `$R/.engine-version`. */
  val manifest: String?,
)

data class InstalledEngine(val tag: String, val sha256: String, val source: String)

class EngineInstallException(message: String, cause: Throwable? = null) : IOException(message, cause)

internal class RangeNotSatisfiable : IOException("range not satisfiable; restarting download")

/**
 * Installs the rootfs: verifies the sha256 first, unpacks into `filesDir/r.partial`, carries the
 * user's data (`/root`) over from an old rootfs, writes `.engine-version`, then renames into
 * `filesDir/r`. The bundled APK asset is the primary source; the network is the fallback.
 */
class EngineInstaller(
  private val context: Context,
  private val paths: EnginePaths = EnginePaths(context),
  private val config: EngineConfig = EngineConfig.load(context),
) {
  private val log = EngineLog.get(context)
  private val assets: AssetManager = context.applicationContext.assets

  // ---------------------------------------------------------------------------------------------
  // Installed state
  // ---------------------------------------------------------------------------------------------

  fun installed(): InstalledEngine? = try {
    if (!paths.installedJson.exists() || !NativeFs.exists(paths.rootfs)) null
    else JSONObject(paths.installedJson.readText()).let {
      InstalledEngine(it.getString("tag"), it.optString("sha256"), it.optString("source", "remote"))
    }
  } catch (_: Exception) {
    null
  }

  fun installedVersion(): String? = installed()?.tag

  fun isInstalled(): Boolean = installed() != null

  // ---------------------------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------------------------

  /** The payload packed into the APK, or null when this build has none. Cheap: reads only the side files. */
  fun bundled(): EngineRelease? {
    val packed = runCatching { assets.list("engine")?.toList() }.getOrNull() ?: return null
    if (EngineConfig.BUNDLED_ASSET.substringAfter('/') !in packed) return null
    val sha = try {
      assets.open(EngineConfig.BUNDLED_SHA256).bufferedReader().use { it.readText() }
        .trim().split(Regex("\\s+")).firstOrNull()?.lowercase()
    } catch (_: IOException) {
      return null
    } ?: return null
    if (!sha.matches(Regex("[0-9a-f]{64}"))) return null
    val manifestText = try {
      assets.open(EngineConfig.BUNDLED_MANIFEST).bufferedReader().use { it.readText() }
    } catch (_: IOException) {
      null
    }
    val manifest = manifestText?.let { runCatching { JSONObject(it) }.getOrNull() }
    val size = try {
      // Works only when the asset is stored uncompressed (noCompress "xz"), which we require.
      assets.openFd(EngineConfig.BUNDLED_ASSET).use { it.length }
    } catch (_: FileNotFoundException) {
      -1L
    } catch (_: IOException) {
      return null
    }
    return EngineRelease(
      tag = manifest?.let(::tagOf) ?: "bundled-${sha.take(12)}",
      source = "bundled",
      url = null,
      apiAsset = false,
      sha256 = sha,
      sha256Url = null,
      size = size.takeIf { it > 0 } ?: manifest?.optLong("compressed_bytes", -1L) ?: -1L,
      installedBytes = manifest?.optLong("installed_bytes", -1L) ?: -1L,
      manifest = manifestText,
    )
  }

  private fun tagOf(json: JSONObject): String? =
    json.optString("tag").ifBlank { null } ?: json.optString("version").ifBlank { null }?.let { "${config.tagPrefix}$it" }

  suspend fun resolveRemote(): EngineRelease = withContext(Dispatchers.IO) {
    val manifest = config.manifestUrl
    if (manifest != null) resolveFromManifest(manifest) else resolveFromGitHub()
  }

  private fun resolveFromManifest(url: String): EngineRelease {
    val text = httpText(url, accept = "application/json", auth = false)
    val json = JSONObject(text)
    return EngineRelease(
      tag = tagOf(json) ?: throw EngineInstallException("engine.json at $url has no tag or version"),
      source = "remote",
      url = json.getString("url"),
      apiAsset = false,
      sha256 = json.optString("sha256").ifBlank { null }?.lowercase(),
      sha256Url = null,
      size = json.optLong("compressed_bytes", json.optLong("size", -1)),
      installedBytes = json.optLong("installed_bytes", -1),
      manifest = text,
    )
  }

  private fun resolveFromGitHub(): EngineRelease {
    val releases = JSONArray(
      httpText("${config.releasesApiUrl.trimEnd('/')}?per_page=50", accept = "application/vnd.github+json", auth = true),
    )
    var best: JSONObject? = null
    for (i in 0 until releases.length()) {
      val r = releases.getJSONObject(i)
      if (r.optBoolean("draft")) continue
      val tag = r.optString("tag_name")
      if (!tag.startsWith(config.tagPrefix) || findAsset(r, config.assetName) == null) continue
      if (best == null || compareTags(tag, best.getString("tag_name")) > 0) best = r
    }
    val release = best ?: throw EngineInstallException(
      "No '${config.tagPrefix}*' release with '${config.assetName}' at ${config.releasesApiUrl}" +
        if (config.githubToken == null) " (the repo is private: set a GitHub token or a public manifestUrl)" else "",
    )
    val asset = findAsset(release, config.assetName)!!
    val side = findAsset(release, "${config.assetName}.sha256")
    val private = config.githubToken != null
    val digest = asset.optString("digest").takeIf { it.startsWith("sha256:") }?.removePrefix("sha256:")
    return EngineRelease(
      tag = release.getString("tag_name"),
      source = "remote",
      url = if (private) asset.getString("url") else asset.getString("browser_download_url"),
      apiAsset = private,
      sha256 = digest?.lowercase(),
      sha256Url = side?.let { if (private) it.getString("url") else it.getString("browser_download_url") },
      size = asset.optLong("size", -1),
      installedBytes = -1,
      manifest = null,
    )
  }

  private fun findAsset(release: JSONObject, name: String): JSONObject? {
    val assets = release.optJSONArray("assets") ?: return null
    for (i in 0 until assets.length()) {
      val a = assets.getJSONObject(i)
      if (a.optString("name") == name) return a
    }
    return null
  }

  /** Compares the numeric runs of two tags: engine-0.57.1 > engine-0.57.0, engine-1.10 > engine-1.9. */
  fun compareTags(a: String, b: String): Int {
    val na = Regex("\\d+").findAll(a).map { it.value.toBigInteger() }.toList()
    val nb = Regex("\\d+").findAll(b).map { it.value.toBigInteger() }.toList()
    for (i in 0 until maxOf(na.size, nb.size)) {
      val x = na.getOrNull(i) ?: return -1
      val y = nb.getOrNull(i) ?: return 1
      val c = x.compareTo(y)
      if (c != 0) return c
    }
    return a.compareTo(b)
  }

  // ---------------------------------------------------------------------------------------------
  // What to install
  // ---------------------------------------------------------------------------------------------

  /**
   * The release start() must install before running, or null when the installed one is fine:
   *  - nothing installed: the bundled payload, else the remote one;
   *  - the APK carries a different payload than the one installed from an earlier APK: the bundled
   *    one (an app update ships a new engine);
   *  - a newer remote install is never downgraded by an older bundle.
   */
  suspend fun pendingInstall(): EngineRelease? {
    val current = installed()
    val bundled = if (config.preferRemote) null else bundled()
    if (bundled != null) {
      if (current == null) return bundled
      if (current.sha256 == bundled.sha256) return null
      if (current.source == "bundled" || compareTags(bundled.tag, current.tag) > 0) return bundled
      return null
    }
    if (current != null) return null
    EngineState.installing(InstallStep.CHECKING, null, message = "Looking for the engine")
    return resolveRemote()
  }

  /**
   * Checks the remote source (rate-limited unless [force]) and records whether it is newer than the
   * installed payload. Never throws. Without a token or public manifest a private repo answers 404,
   * which is logged and otherwise ignored.
   */
  suspend fun checkForUpdate(force: Boolean): EngineRelease? = withContext(Dispatchers.IO) {
    if (config.manifestUrl == null && config.githubToken == null && config.releasesApiUrl == EngineConfig.DEFAULT_RELEASES_API) {
      // The default repo is private; nothing to ask without credentials.
      return@withContext null
    }
    val now = System.currentTimeMillis()
    if (!force) {
      val last = runCatching { JSONObject(paths.updateCheckJson.readText()).optLong("checkedAt", 0) }.getOrDefault(0L)
      if (now - last < config.updateCheckIntervalMs) return@withContext null
    }
    try {
      val latest = resolveRemote()
      paths.root.mkdirs()
      paths.updateCheckJson.writeText(JSONObject().put("checkedAt", now).put("latest", latest.tag).toString())
      val installed = installedVersion()
      val newer = installed != null && compareTags(latest.tag, installed) > 0
      EngineState.update { it.copy(latestVersion = latest.tag, updateAvailable = newer) }
      latest
    } catch (e: Exception) {
      log.system("Update check failed: ${e.message}")
      null
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Install
  // ---------------------------------------------------------------------------------------------

  /** Installs [release]. The engine must be stopped first (the service does that). */
  suspend fun install(release: EngineRelease) = withContext(Dispatchers.IO) {
    paths.ensureDirs()
    log.system("Installing engine ${release.tag} (${release.source})")
    checkFreeSpace(release)
    when (release.source) {
      "bundled" -> {
        val expected = release.sha256!!
        verify(release.tag, release.size, expected) { assets.open(EngineConfig.BUNDLED_ASSET, AssetManager.ACCESS_STREAMING) }
        unpackAndSwap(release, expected, release.size) { assets.open(EngineConfig.BUNDLED_ASSET, AssetManager.ACCESS_STREAMING) }
      }
      else -> {
        val archive = download(release)
        val expected = release.sha256 ?: release.sha256Url?.let { readSha256SideFile(it, release.apiAsset) }
          ?: throw EngineInstallException("Release ${release.tag} has no sha256")
        try {
          verify(release.tag, archive.length(), expected) { archive.inputStream() }
        } catch (e: EngineInstallException) {
          archive.delete()
          throw e
        }
        unpackAndSwap(release, expected, archive.length()) { archive.inputStream() }
        archive.delete()
      }
    }
  }

  private suspend fun verify(tag: String, size: Long, expected: String, open: () -> InputStream) {
    val digest = MessageDigest.getInstance("SHA-256")
    var done = 0L
    var lastEmit = 0L
    val ctx = currentCoroutineContext()
    open().use { input ->
      val buffer = ByteArray(1 shl 16)
      while (true) {
        ctx.ensureActive()
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
        done += read
        val now = System.currentTimeMillis()
        if (now - lastEmit > 250) {
          lastEmit = now
          EngineState.installing(InstallStep.VERIFYING, if (size > 0) done.toDouble() / size else null, done, size.coerceAtLeast(0), "Checking $tag")
        }
      }
    }
    val actual = digest.digest().joinToString("") { "%02x".format(it) }
    if (!actual.equals(expected, ignoreCase = true)) {
      throw EngineInstallException("sha256 mismatch for $tag: got $actual, expected $expected")
    }
  }

  private suspend fun unpackAndSwap(release: EngineRelease, sha256: String, size: Long, open: () -> InputStream) {
    NativeFs.deleteTree(paths.staging)
    EngineState.installing(InstallStep.EXTRACTING, 0.0, message = "Unpacking ${release.tag}")
    val ctx = currentCoroutineContext()
    val result = open().use { input ->
      TarXzExtractor.extract(
        input,
        size,
        paths.staging,
        onProgress = { EngineState.installing(InstallStep.EXTRACTING, it, message = "Unpacking ${release.tag}") },
        shouldContinue = { ctx.isActive },
      )
    }
    log.system("Unpacked ${result.files} files, ${result.symlinks} symlinks (${result.bytes / (1024 * 1024)} MiB)")
    if (!File(paths.staging, EngineConfig.START_SCRIPT.trimStart('/')).exists()) {
      NativeFs.deleteTree(paths.staging)
      throw EngineInstallException("Payload ${release.tag} has no ${EngineConfig.START_SCRIPT}")
    }
    // The launcher binds $R/tmp to /dev/shm and makes /run/openbot itself; make sure both parents exist.
    File(paths.staging, "tmp").mkdirs()
    File(paths.staging, "run").mkdirs()

    if (NativeFs.exists(paths.rootfs)) {
      EngineState.installing(InstallStep.MIGRATING, null, message = "Keeping your sign-in and data")
      for (p in config.persistPaths) carryOver(p)
      // Stale runtime state from the old engine must not look like a live one.
      NativeFs.deleteTree(File(paths.staging, "run/openbot"))
      NativeFs.move(paths.rootfs, File(paths.trash, "r-${System.currentTimeMillis()}"))
    }
    File(paths.staging, ".engine-version").writeText(release.manifest ?: "${release.tag}\n")
    NativeFs.move(paths.staging, paths.rootfs)
    paths.installedJson.writeText(
      JSONObject()
        .put("tag", release.tag)
        .put("sha256", sha256)
        .put("source", release.source)
        .put("installedAt", System.currentTimeMillis())
        .toString(),
    )
    paths.trash.listFiles()?.forEach { NativeFs.deleteTree(it) }
    EngineState.update {
      it.copy(installedVersion = release.tag, updateAvailable = false, installStep = null, progress = null)
    }
    log.system("Engine ${release.tag} installed")
  }

  /** Moves `$R/<rel>` from the old rootfs into the staged one; the old copy wins except for keepNewPaths. */
  private fun carryOver(rel: String) {
    val from = File(paths.rootfs, rel)
    val to = File(paths.staging, rel)
    if (!NativeFs.exists(from)) return
    if (config.keepNewPaths.any { it == rel }) return
    val keepBelow = config.keepNewPaths.any { it.startsWith("$rel/") }
    if (keepBelow && from.isDirectory && !NativeFs.isSymlink(from) && to.isDirectory) {
      from.list()?.forEach { carryOver("$rel/$it") }
      return
    }
    log.system("Carrying over /$rel")
    NativeFs.move(from, to)
  }

  /** Removes the payload. Logs and config stay. The engine must be stopped. */
  fun uninstall() {
    NativeFs.deleteTree(paths.rootfs)
    NativeFs.deleteTree(paths.staging)
    NativeFs.deleteTree(paths.trash)
    NativeFs.deleteTree(paths.downloads)
    paths.installedJson.delete()
    EngineState.update { it.copy(installedVersion = null, updateAvailable = false) }
  }

  private fun checkFreeSpace(release: EngineRelease) {
    val free = StatFs(context.filesDir.path).availableBytes
    val unpacked = release.installedBytes.takeIf { it > 0 } ?: (release.size.takeIf { it > 0 }?.times(4)) ?: return
    // README-ENGINE.md: unpacked + ~300 MB for data (+ the download when remote).
    val needed = unpacked + 300L * 1024 * 1024 + if (release.source == "remote") release.size.coerceAtLeast(0) else 0
    if (free < needed) {
      throw EngineInstallException("Not enough storage: ${free / (1024 * 1024)} MiB free, about ${needed / (1024 * 1024)} MiB needed")
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Remote download
  // ---------------------------------------------------------------------------------------------

  private suspend fun download(release: EngineRelease): File {
    val url = release.url ?: throw EngineInstallException("Release ${release.tag} has no download URL")
    val safeTag = release.tag.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val done = File(paths.downloads, "$safeTag-${config.assetName}")
    if (done.exists() && (release.size <= 0 || done.length() == release.size)) return done
    val part = File(paths.downloads, "${done.name}.part")
    paths.downloads.listFiles()?.filter { it != part }?.forEach { it.delete() }
    var attempt = 0
    while (true) {
      try {
        downloadOnce(release, url, part)
        if (!part.renameTo(done)) throw EngineInstallException("cannot rename ${part.name}")
        return done
      } catch (e: IOException) {
        currentCoroutineContext().ensureActive()
        if (e is RangeNotSatisfiable) part.delete()
        if (++attempt >= 4) throw EngineInstallException("Download failed: ${e.message}", e)
        log.system("Download interrupted (${e.message}); retrying ($attempt/3)")
        delay(2000L * attempt)
      }
    }
  }

  private suspend fun downloadOnce(release: EngineRelease, url: String, part: File) {
    val existing = if (part.exists()) part.length() else 0L
    val conn = open(url, if (release.apiAsset) "application/octet-stream" else null, release.apiAsset, existing)
    try {
      val resumed = existing > 0 && conn.responseCode == HttpURLConnection.HTTP_PARTIAL
      val length = conn.contentLengthLong
      val total = when {
        release.size > 0 -> release.size
        length > 0 -> if (resumed) existing + length else length
        else -> -1L
      }
      var done = if (resumed) existing else 0L
      val ctx = currentCoroutineContext()
      var lastEmit = 0L
      FileOutputStream(part, resumed).use { out ->
        conn.inputStream.use { input ->
          val buffer = ByteArray(1 shl 16)
          while (true) {
            ctx.ensureActive()
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
            done += read
            val now = System.currentTimeMillis()
            if (now - lastEmit > 250) {
              lastEmit = now
              EngineState.installing(
                InstallStep.DOWNLOADING,
                if (total > 0) done.toDouble() / total else null,
                done,
                total.coerceAtLeast(0),
                "Downloading ${release.tag}",
              )
            }
          }
        }
      }
      if (total > 0 && done != total) throw IOException("short download: $done of $total bytes")
    } finally {
      conn.disconnect()
    }
  }

  private fun readSha256SideFile(url: String, api: Boolean): String {
    val text = httpText(url, if (api) "application/octet-stream" else null, api)
    return text.trim().split(Regex("\\s+")).firstOrNull()?.lowercase()?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
      ?: throw EngineInstallException("Malformed sha256 file at ${redact(url)}")
  }

  private fun httpText(url: String, accept: String?, auth: Boolean): String {
    val conn = open(url, accept, auth, 0)
    try {
      return conn.inputStream.bufferedReader().use { it.readText() }
    } finally {
      conn.disconnect()
    }
  }

  /**
   * Follows redirects by hand: GitHub answers asset downloads with a 302 to signed storage, which
   * rejects an Authorization header, so the token only ever goes to api.github.com.
   */
  private fun open(url: String, accept: String?, auth: Boolean, rangeStart: Long): HttpURLConnection {
    var current = URL(url)
    var hops = 0
    while (true) {
      val conn = (current.openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 20_000
        readTimeout = 60_000
        setRequestProperty("User-Agent", "OpenBotLocal-Engine/1")
        accept?.let { setRequestProperty("Accept", it) }
        val token = config.githubToken
        if (auth && token != null && current.host == "api.github.com") {
          setRequestProperty("Authorization", "Bearer $token")
          setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        }
        if (rangeStart > 0) setRequestProperty("Range", "bytes=$rangeStart-")
      }
      val code = conn.responseCode
      if (code in 300..399) {
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        if (location == null || ++hops > 6) throw IOException("bad redirect from ${redact(current.toString())}")
        current = URL(current, location)
        continue
      }
      if (code >= 400) {
        val detail = runCatching { conn.errorStream?.bufferedReader()?.use { it.readText().take(300) } }.getOrNull()
        conn.disconnect()
        if (code == 416 && rangeStart > 0) throw RangeNotSatisfiable()
        throw EngineInstallException("HTTP $code from ${redact(current.toString())}${detail?.let { ": $it" } ?: ""}")
      }
      return conn
    }
  }

  private fun redact(url: String): String = url.substringBefore('?')
}
