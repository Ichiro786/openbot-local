package run.openbot.engine

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Where the engine payload comes from and how the engine runs. Defaults are compiled in; JS can
 * override them with `setConfig`, and overrides persist in private SharedPreferences.
 *
 * Payload sources, in order:
 *  1. **Bundled** (primary): `assets/engine/rootfs-arm64.tar.xz` + `.sha256` (+ optional
 *     `engine.json`) packed into the APK by the build workflow, stored uncompressed.
 *  2. **Remote** (fallback, or when [preferRemote]):
 *     - [manifestUrl]: a public `engine.json` with `tag`, `url`, `sha256`, `compressed_bytes`
 *       (the `engine-latest` release format), or
 *     - the GitHub Releases API at [releasesApiUrl]: the newest non-draft `engine-*` release with
 *       an asset [assetName]; sha256 from the asset digest or `<assetName>.sha256`. A private repo
 *       needs [githubToken] (fine-grained, Contents: read, that repo only).
 */
data class EngineConfig(
  val releasesApiUrl: String,
  val manifestUrl: String?,
  val tagPrefix: String,
  val assetName: String,
  val githubToken: String?,
  val preferRemote: Boolean,
  val autoRestart: Boolean,
  /** OPENBOT_PROOT_PROFILE passed to the launcher; null lets the launcher use its remembered one. */
  val profile: String?,
  /** Extra `KEY=VALUE` for the guest (OPENBOT_VERBOSE, OPENBOT_EXTRA_FLAGS, ...), passed through env -i. */
  val guestEnv: Map<String, String>,
  val noSeccomp: Boolean,
  /** How long a graceful stop may take before proot is killed. Launcher default stop window is 50 s. */
  val stopTimeoutMs: Long,
  /** Write the device's DNS servers to $R/etc/resolv.conf before each start. */
  val syncDns: Boolean,
  /** Guest paths carried from the old rootfs into a new one on update. */
  val persistPaths: List<String>,
  /** Paths under [persistPaths] where the NEW payload's copy wins (launcher scripts). */
  val keepNewPaths: List<String>,
  val updateCheckIntervalMs: Long,
) {
  companion object {
    const val BUNDLED_ASSET = "engine/rootfs-arm64.tar.xz"
    const val BUNDLED_SHA256 = "engine/rootfs-arm64.tar.xz.sha256"
    const val BUNDLED_MANIFEST = "engine/engine.json"

    /** The fork's releases; private today, so remote install needs a token or a public mirror. */
    const val DEFAULT_RELEASES_API = "https://api.github.com/repos/Ichiro786/openbot-local/releases"
    const val DEFAULT_TAG_PREFIX = "engine-"
    const val DEFAULT_ASSET = "rootfs-arm64.tar.xz"
    const val START_SCRIPT = "/root/openbot-start.sh"
    const val DEFAULT_PROFILE = "safe"
    val DEFAULT_PERSIST = listOf("root")
    val DEFAULT_KEEP_NEW = listOf("root/openbot-start.sh", "root/openbot-status.sh")
    const val DEFAULT_STOP_TIMEOUT_MS = 60_000L
    const val DEFAULT_UPDATE_INTERVAL_MS = 6L * 60 * 60 * 1000

    private const val PREFS = "openbot_engine_config"

    fun prefs(context: Context): SharedPreferences =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun lines(value: String?): List<String>? =
      value?.split('\n')?.map { it.trim() }?.filter { it.isNotEmpty() }

    fun load(context: Context): EngineConfig {
      val p = prefs(context)
      val env = try {
        val json = JSONObject(p.getString("guestEnv", null) ?: "{}")
        json.keys().asSequence().associateWith { json.getString(it) }
      } catch (_: Exception) {
        emptyMap()
      }
      return EngineConfig(
        releasesApiUrl = p.getString("releasesApiUrl", null)?.ifBlank { null } ?: DEFAULT_RELEASES_API,
        manifestUrl = p.getString("manifestUrl", null)?.ifBlank { null },
        tagPrefix = p.getString("tagPrefix", null)?.ifBlank { null } ?: DEFAULT_TAG_PREFIX,
        assetName = p.getString("assetName", null)?.ifBlank { null } ?: DEFAULT_ASSET,
        githubToken = p.getString("githubToken", null)?.ifBlank { null },
        preferRemote = p.getBoolean("preferRemote", false),
        autoRestart = p.getBoolean("autoRestart", true),
        profile = if (p.contains("profile")) p.getString("profile", null)?.ifBlank { null } else DEFAULT_PROFILE,
        guestEnv = env,
        noSeccomp = p.getBoolean("noSeccomp", false),
        stopTimeoutMs = p.getLong("stopTimeoutMs", DEFAULT_STOP_TIMEOUT_MS),
        syncDns = p.getBoolean("syncDns", true),
        persistPaths = lines(p.getString("persistPaths", null)) ?: DEFAULT_PERSIST,
        keepNewPaths = DEFAULT_KEEP_NEW,
        updateCheckIntervalMs = p.getLong("updateCheckIntervalMs", DEFAULT_UPDATE_INTERVAL_MS),
      )
    }

    /** Applies the fields present in [input]. An empty string resets a string field to its default. */
    fun save(context: Context, input: EngineConfigInput) {
      prefs(context).edit().apply {
        input.releasesApiUrl?.let { putString("releasesApiUrl", it) }
        input.manifestUrl?.let { putString("manifestUrl", it) }
        input.tagPrefix?.let { putString("tagPrefix", it) }
        input.assetName?.let { putString("assetName", it) }
        input.githubToken?.let { putString("githubToken", it) }
        input.preferRemote?.let { putBoolean("preferRemote", it) }
        input.autoRestart?.let { putBoolean("autoRestart", it) }
        // "" = let the launcher pick its remembered profile; "default" = back to safe.
        input.profile?.let { if (it == "default") remove("profile") else putString("profile", it) }
        input.guestEnv?.let { putString("guestEnv", JSONObject(it as Map<*, *>).toString()) }
        input.noSeccomp?.let { putBoolean("noSeccomp", it) }
        input.stopTimeoutMs?.let { putLong("stopTimeoutMs", it.toLong()) }
        input.syncDns?.let { putBoolean("syncDns", it) }
        input.persistPaths?.let { putString("persistPaths", it.joinToString("\n")) }
        input.updateCheckIntervalMs?.let { putLong("updateCheckIntervalMs", it.toLong()) }
      }.apply()
    }
  }

  /** What JS may read back. The token is never returned, only whether one is set. */
  fun toMap(): Map<String, Any?> = mapOf(
    "releasesApiUrl" to releasesApiUrl,
    "manifestUrl" to manifestUrl,
    "tagPrefix" to tagPrefix,
    "assetName" to assetName,
    "hasGithubToken" to (githubToken != null),
    "preferRemote" to preferRemote,
    "autoRestart" to autoRestart,
    "profile" to profile,
    "guestEnv" to guestEnv,
    "noSeccomp" to noSeccomp,
    "stopTimeoutMs" to stopTimeoutMs.toDouble(),
    "syncDns" to syncDns,
    "persistPaths" to persistPaths,
    "updateCheckIntervalMs" to updateCheckIntervalMs.toDouble(),
  )
}
