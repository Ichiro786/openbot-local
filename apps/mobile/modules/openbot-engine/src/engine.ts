import type {
  CommandOutputEvent,
  CommandResult,
  ControlResponse,
  EngineConfig,
  EngineConfigInput,
  EngineStatus,
  NotificationPermission,
  UpdateCheck,
} from "./OpenBotEngine.types";
import { native } from "./OpenBotEngineModule";

export const UNSUPPORTED_STATUS: EngineStatus = {
  phase: "unsupported",
  installStep: null,
  progress: null,
  bytesDone: 0,
  bytesTotal: 0,
  message: "The local engine runs on Android builds only",
  installedVersion: null,
  latestVersion: null,
  updateAvailable: false,
  restartCount: 0,
  nextRestartAtMs: null,
  pid: null,
  startedAtMs: null,
  lastExitCode: null,
};

export const isEngineSupported = native != null;

/** Starts the engine service: first launch downloads and unpacks the payload, then runs it. */
export async function start(): Promise<void> {
  await native?.start();
}

export async function stop(): Promise<void> {
  await native?.stop();
}

export async function restart(): Promise<void> {
  await native?.restart();
}

/** Installs the newest engine release if it is newer than the installed one, then restarts. */
export async function update(): Promise<void> {
  await native?.update();
}

export function status(): EngineStatus {
  return native?.status() ?? UNSUPPORTED_STATUS;
}

export async function getLogTail(lines = 200): Promise<string[]> {
  return (await native?.getLogTail(lines)) ?? [];
}

export async function clearLogs(): Promise<void> {
  await native?.clearLogs();
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!native) return { installedVersion: null, latestVersion: null, updateAvailable: false, error: "unsupported" };
  return native.checkForUpdate();
}

export async function getConfig(): Promise<EngineConfig | null> {
  return (await native?.getConfig()) ?? null;
}

export async function setConfig(input: EngineConfigInput): Promise<EngineConfig | null> {
  return (await native?.setConfig(input)) ?? null;
}

/** Deletes the installed payload; the next start() downloads it again. */
export async function reset(): Promise<void> {
  await native?.reset();
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!native) return false;
  const result: NotificationPermission = await native.requestNotificationPermission();
  return result.granted;
}

export function isIgnoringBatteryOptimizations(): boolean {
  return native?.isIgnoringBatteryOptimizations() ?? true;
}

/** Shows the system dialog once per install (or again with force). True when already exempt. */
export async function requestIgnoreBatteryOptimizations(force = false): Promise<boolean> {
  return (await native?.requestIgnoreBatteryOptimizations(force)) ?? true;
}

// -------------------------------------------------------------------------------------------------
// Live Updates and Material You (Android only; no-ops elsewhere)
// -------------------------------------------------------------------------------------------------

/** Shows or updates the Android Live Update for running agent work. `props` is AgentLiveActivityProps. */
export function showLiveUpdate(props: unknown): void {
  try {
    native?.showLiveUpdate(JSON.stringify(props));
  } catch {
    // A missing permission or an OEM refusal leaves the app working without the notification.
  }
}

export function endLiveUpdate(): void {
  try {
    native?.endLiveUpdate();
  } catch {
    // Nothing to end.
  }
}

export function isLiveUpdateShown(): boolean {
  try {
    return native?.isLiveUpdateShown() ?? false;
  } catch {
    return false;
  }
}

export function setLiveUpdateAccent(color: string | null): void {
  try {
    native?.setLiveUpdateAccent(color);
  } catch {
    // Keeps the brand color.
  }
}

/** Android 16+: whether Live Updates can show as a status bar chip (the user can turn this off per app). */
export function canPromoteLiveUpdates(): boolean {
  try {
    return native?.canPromoteLiveUpdates() ?? false;
  } catch {
    return false;
  }
}

export function openLiveUpdateSettings(): void {
  try {
    native?.openLiveUpdateSettings();
  } catch {
    // No settings page on this build.
  }
}

/** Android API level, or 0 off Android. */
export function androidSdkInt(): number {
  try {
    return native?.getSdkInt() ?? 0;
  } catch {
    return 0;
  }
}

/** The Material You tonal palettes (`accent1_600` → `#RRGGBB`), or null below Android 12. */
export function getDynamicColors(): Record<string, string> | null {
  try {
    return native?.getDynamicColors() ?? null;
  } catch {
    return null;
  }
}

export function addStatusListener(listener: (status: EngineStatus) => void): () => void {
  const subscription = native?.addListener("onStatusChange", listener);
  return () => subscription?.remove();
}

// -------------------------------------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------------------------------------

export interface CommandOptions {
  /** Kill the command after this long. Default: no limit. */
  timeoutMs?: number;
  /** Called with each chunk of stdout/stderr as it arrives. */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

export interface CommandHandle {
  id: string;
  result: Promise<CommandResult>;
  /** Writes to the command's stdin. False when it already ended. */
  write(text: string): boolean;
  cancel(): boolean;
}

let nextCommand = 0;

/**
 * Starts `/bin/sh -c <command>` inside the engine rootfs, as root, in /root. Use the handle to
 * stream output, answer prompts and cancel. Rejects when the payload is not installed yet.
 */
export function startCommand(command: string, options: CommandOptions = {}): CommandHandle {
  const id = `cmd-${Date.now().toString(36)}-${(nextCommand++).toString(36)}`;
  if (!native) {
    return {
      id,
      result: Promise.reject(new Error("The local engine is not available on this platform")),
      write: () => false,
      cancel: () => false,
    };
  }
  const engine = native;
  const subscription = options.onOutput
    ? engine.addListener("onCommandOutput", (event: CommandOutputEvent) => {
        if (event.id === id) options.onOutput?.(event.chunk, event.stream);
      })
    : null;
  const result = engine.runCommand(id, command, options.timeoutMs ?? null).finally(() => subscription?.remove());
  return {
    id,
    result,
    write: (text) => engine.writeCommandInput(id, text),
    cancel: () => engine.cancelCommand(id),
  };
}

/** Runs a command to completion. */
export function runCommand(command: string, options: CommandOptions = {}): Promise<CommandResult> {
  return startCommand(command, options).result;
}

// -------------------------------------------------------------------------------------------------
// Control socket (sign-in)
// -------------------------------------------------------------------------------------------------

function requireNative() {
  if (!native) throw new Error("The local engine is not available on this platform");
  return native;
}

/** GET /v1/status: `account`, `server` (unconfigured|starting|online|error), `version`, ... */
export function controlStatus(): Promise<ControlResponse> {
  return requireNative().controlStatus();
}

/** Email-code sign-in, step 1. The answer's `fields.challenge` goes to loginVerify. */
export function loginStart(email: string, name?: string): Promise<ControlResponse> {
  return requireNative().loginStart(email, name ?? null);
}

/** Step 2: the code from the email. */
export function loginVerify(challenge: string, code: string, name?: string): Promise<ControlResponse> {
  return requireNative().loginVerify(challenge, code, name ?? null);
}

export function loginClaim(): Promise<ControlResponse> {
  return requireNative().loginClaim();
}

export function logout(): Promise<ControlResponse> {
  return requireNative().logout();
}

let installStarted = false;

/**
 * Starts the engine once per app process (the root layout calls this on launch). The first start
 * unpacks the bundled payload. Never throws; failures show up in status().
 */
export function installLocalEngine(): void {
  if (!native || installStarted) return;
  installStarted = true;
  void requestNotificationPermission()
    .catch(() => false)
    .finally(() => {
      void native?.start().catch(() => {
        installStarted = false;
      });
    });
}
