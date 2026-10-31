package run.openbot.engine

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `setConfig` argument. Every field is optional; only the ones given change. */
class EngineConfigInput : Record {
  @Field var releasesApiUrl: String? = null
  @Field var manifestUrl: String? = null
  @Field var tagPrefix: String? = null
  @Field var assetName: String? = null
  @Field var githubToken: String? = null
  @Field var preferRemote: Boolean? = null
  @Field var autoRestart: Boolean? = null
  @Field var profile: String? = null
  @Field var guestEnv: Map<String, String>? = null
  @Field var noSeccomp: Boolean? = null
  @Field var stopTimeoutMs: Double? = null
  @Field var syncDns: Boolean? = null
  @Field var persistPaths: List<String>? = null
  @Field var updateCheckIntervalMs: Double? = null
}
