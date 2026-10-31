export type EnginePhase =
  | "idle"
  | "installing"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed"
  | "error"
  /** iOS, web, Expo Go, Android < 8, or a build without the native module. */
  | "unsupported";

export type EngineInstallStep = "checking" | "downloading" | "verifying" | "extracting" | "migrating";

export interface EngineStatus {
  phase: EnginePhase;
  installStep: EngineInstallStep | null;
  /** 0..1 for the current install step; null when unknown. */
  progress: number | null;
  bytesDone: number;
  bytesTotal: number;
  message: string | null;
  /** Release tag of the installed payload, e.g. "engine-2026.11.01". */
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  restartCount: number;
  /** Epoch ms of the next automatic restart after a crash. */
  nextRestartAtMs: number | null;
  pid: number | null;
  startedAtMs: number | null;
  lastExitCode: number | null;
}

/** What getConfig/setConfig answer (EngineConfig.toMap in Kotlin). The token itself is never returned. */
export interface EngineConfig {
  releasesApiUrl: string;
  manifestUrl: string | null;
  tagPrefix: string;
  assetName: string;
  hasGithubToken: boolean;
  preferRemote: boolean;
  autoRestart: boolean;
  /** OPENBOT_PROOT_PROFILE; null lets the launcher use the one it remembered. */
  profile: string | null;
  guestEnv: Record<string, string>;
  noSeccomp: boolean;
  stopTimeoutMs: number;
  syncDns: boolean;
  persistPaths: string[];
  updateCheckIntervalMs: number;
}

/** Fields to change (EngineConfigInput in Kotlin). An empty string resets a string field to its default. */
export interface EngineConfigInput {
  releasesApiUrl?: string;
  /** Public JSON `{ tag, url, sha256, compressed_bytes? }`; when set it replaces the GitHub Releases lookup. */
  manifestUrl?: string;
  tagPrefix?: string;
  assetName?: string;
  /**
   * Fine-grained GitHub token with read access to the private releases repo. Stored in the app's
   * private preferences on this device only. Never bake it into the JS bundle.
   */
  githubToken?: string;
  preferRemote?: boolean;
  autoRestart?: boolean;
  /** "" = launcher's remembered profile, "default" = back to "safe". */
  profile?: string;
  guestEnv?: Record<string, string>;
  noSeccomp?: boolean;
  stopTimeoutMs?: number;
  syncDns?: boolean;
  persistPaths?: string[];
  updateCheckIntervalMs?: number;
}

/** An answer of OpenBot's control socket: HTTP status plus the parsed `key=value` body. */
export interface ControlResponse {
  status: number;
  ok: boolean;
  fields: Record<string, string>;
  body: string;
}

export interface CommandResult {
  id: string;
  /** null when cancelled or timed out. */
  exitCode: number | null;
  /** stdout + stderr as they arrived, capped at 256 KiB. */
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

export interface CommandOutputEvent {
  id: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface UpdateCheck {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  error: string | null;
}

export interface NotificationPermission {
  granted: boolean;
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
}

export type OpenBotEngineEvents = {
  onStatusChange: (status: EngineStatus) => void;
  onCommandOutput: (event: CommandOutputEvent) => void;
  onCommandExit: (event: CommandResult) => void;
};
