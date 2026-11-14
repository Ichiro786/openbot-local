// OpenBot Local (build 15.1): "Rich UI in replies" (on/off, Settings > Local engine) and "Rich UI
// usage" (Low / Balanced / High, Settings > Appearance) share one file in the rootfs that the engine
// (engine-0.70.0-3, patch 0004) reads by mtime:
//   v2: {"version":2,"enabled":bool,"level":"low"|"balanced"|"high"}
//   v1: {"version":1,"enabled":bool}   (build 15) -> balanced
// Missing or unreadable = ON + balanced, the same defaults as the engine. Each screen writes the
// whole file with the other screen's value kept, so neither setting resets the other. Pure, so it is
// unit-tested; the reads and writes through the engine's command runner are in dm-context-section.
export type OpenbotUiLevel = "low" | "balanced" | "high";
export const OPENBOT_UI_LEVELS: readonly OpenbotUiLevel[] = ["low", "balanced", "high"];

export interface OpenbotUiSetting {
  enabled: boolean;
  level: OpenbotUiLevel;
}

export const OPENBOT_UI_DIR = "/root/.openbot-local";
export const OPENBOT_UI_FILE = `${OPENBOT_UI_DIR}/openbot-ui.json`;
const DEFAULT_SETTING: OpenbotUiSetting = { enabled: true, level: "balanced" };

function isLevel(value: unknown): value is OpenbotUiLevel {
  return value === "low" || value === "balanced" || value === "high";
}

/** The file's text (v1, v2, empty or broken) as a setting, with the engine's defaults. */
export function parseOpenbotUiSetting(text: string): OpenbotUiSetting {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return DEFAULT_SETTING;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTING;
  const enabled = !("enabled" in parsed && parsed.enabled === false);
  const level = "level" in parsed && isLevel(parsed.level) ? parsed.level : "balanced";
  return { enabled, level };
}

/** The v2 file text for a setting. */
export function openbotUiSettingJson(setting: OpenbotUiSetting): string {
  return JSON.stringify({ version: 2, enabled: setting.enabled, level: setting.level });
}
