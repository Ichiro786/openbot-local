package run.openbot.engine

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class EnginePhase(val js: String) {
  IDLE("idle"),
  INSTALLING("installing"),
  STARTING("starting"),
  RUNNING("running"),
  STOPPING("stopping"),
  STOPPED("stopped"),
  CRASHED("crashed"),
  ERROR("error"),
  UNSUPPORTED("unsupported"),
}

enum class InstallStep(val js: String) {
  CHECKING("checking"),
  DOWNLOADING("downloading"),
  VERIFYING("verifying"),
  EXTRACTING("extracting"),
  MIGRATING("migrating"),
}

data class EngineStatus(
  val phase: EnginePhase = EnginePhase.IDLE,
  val installStep: InstallStep? = null,
  /** 0..1 for the current install step, null when unknown. */
  val progress: Double? = null,
  val bytesDone: Long = 0,
  val bytesTotal: Long = 0,
  val message: String? = null,
  val installedVersion: String? = null,
  val latestVersion: String? = null,
  val updateAvailable: Boolean = false,
  val restartCount: Int = 0,
  val nextRestartAtMs: Long? = null,
  val pid: Int? = null,
  val startedAtMs: Long? = null,
  val lastExitCode: Int? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "phase" to phase.js,
    "installStep" to installStep?.js,
    "progress" to progress,
    "bytesDone" to bytesDone.toDouble(),
    "bytesTotal" to bytesTotal.toDouble(),
    "message" to message,
    "installedVersion" to installedVersion,
    "latestVersion" to latestVersion,
    "updateAvailable" to updateAvailable,
    "restartCount" to restartCount,
    "nextRestartAtMs" to nextRestartAtMs?.toDouble(),
    "pid" to pid,
    "startedAtMs" to startedAtMs?.toDouble(),
    "lastExitCode" to lastExitCode,
  )
}

/** One status for the process. The service writes it, the module and notification read it. */
object EngineState {
  private val state = MutableStateFlow(EngineStatus())
  val status: StateFlow<EngineStatus> = state.asStateFlow()

  val current: EngineStatus get() = state.value

  fun update(transform: (EngineStatus) -> EngineStatus) = state.update(transform)

  fun installing(step: InstallStep, progress: Double?, done: Long = 0, total: Long = 0, message: String? = null) =
    update {
      it.copy(
        phase = EnginePhase.INSTALLING,
        installStep = step,
        progress = progress,
        bytesDone = done,
        bytesTotal = total,
        message = message,
      )
    }
}
