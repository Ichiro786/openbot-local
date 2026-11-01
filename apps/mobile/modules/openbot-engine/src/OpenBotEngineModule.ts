import { type NativeModule, requireOptionalNativeModule } from "expo";
import type {
  CommandResult,
  ControlResponse,
  EngineConfig,
  EngineConfigInput,
  EngineStatus,
  NotificationPermission,
  OpenBotEngineEvents,
  UpdateCheck,
} from "./OpenBotEngine.types";

declare class OpenBotEngineNative extends NativeModule<OpenBotEngineEvents> {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  update(): Promise<void>;
  status(): EngineStatus;
  isServiceRunning(): boolean;
  getLogTail(lines: number): Promise<string[]>;
  clearLogs(): Promise<void>;
  checkForUpdate(): Promise<UpdateCheck>;
  runCommand(id: string, command: string, timeoutMs: number | null): Promise<CommandResult>;
  writeCommandInput(id: string, text: string): boolean;
  cancelCommand(id: string): boolean;
  getConfig(): Promise<EngineConfig>;
  setConfig(input: EngineConfigInput): Promise<EngineConfig>;
  reset(): Promise<void>;
  controlStatus(): Promise<ControlResponse>;
  loginStart(email: string, name: string | null): Promise<ControlResponse>;
  loginVerify(challenge: string, code: string, name: string | null): Promise<ControlResponse>;
  loginClaim(): Promise<ControlResponse>;
  logout(): Promise<ControlResponse>;
  requestNotificationPermission(): Promise<NotificationPermission>;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(force: boolean): Promise<boolean>;
  showLiveUpdate(json: string): void;
  endLiveUpdate(): void;
  isLiveUpdateShown(): boolean;
  setLiveUpdateAccent(color: string | null): void;
  canPromoteLiveUpdates(): boolean;
  openLiveUpdateSettings(): void;
  getSdkInt(): number;
  getDynamicColors(): Record<string, string> | null;
}

/** `modules/openbot-engine`. Null on iOS, web and Expo Go, which have no local engine. */
export const native = requireOptionalNativeModule<OpenBotEngineNative>("OpenBotEngine");
