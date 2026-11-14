// OpenBot Local (build 8): "Share DM context in group chats". The engine patch (engine-0.59.0-2)
// reads /root/.openbot-local/dm-context.json inside the rootfs on every channel turn; a missing file
// means ON. Saving writes that file through the engine's command runner, so the next channel turn
// picks it up without a restart. Engines older than 0.59.0-2 ignore the file.
// Build 15: "Rich UI in replies" is the same kind of switch over openbot-ui.json (engine-0.70.0-2,
// patch 0004: the openbot-ui guide in every agent's instructions; docs/openbot-ui.md).
// Build 15.1: openbot-ui.json is v2 and also carries "Rich UI usage" (OpenbotUiLevelSection, shown in
// Settings > Appearance); both screens read the file and write it back whole (openbot-ui-setting.ts).
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { runCommand, useOpenBotEngine } from "../../../modules/openbot-engine";
import {
  OPENBOT_UI_DIR,
  OPENBOT_UI_FILE,
  OPENBOT_UI_LEVELS,
  type OpenbotUiLevel,
  type OpenbotUiSetting,
  openbotUiSettingJson,
  parseOpenbotUiSetting,
} from "./openbot-ui-setting";

const DIR = "/root/.openbot-local";

interface SwitchCopy {
  title: MobileTextKey;
  label: MobileTextKey;
  footer: MobileTextKey;
}

const DM_CONTEXT_COPY = {
  title: "mobile.settings.dmContext.title",
  label: "mobile.settings.dmContext.label",
  footer: "mobile.settings.dmContext.footer",
} as const satisfies SwitchCopy;

const OPENBOT_UI_COPY = {
  title: "mobile.settings.openbotUi.title",
  label: "mobile.settings.openbotUi.label",
  footer: "mobile.settings.openbotUi.footer",
} as const satisfies SwitchCopy;

const DM_CONTEXT_FILE = `${DIR}/dm-context.json`;

async function readDmContext(): Promise<boolean> {
  const result = await runCommand(`cat ${DM_CONTEXT_FILE} 2>/dev/null || true`, { timeoutMs: 15_000 });
  // Default ON: only an explicit {"enabled": false} turns it off, as in the engine.
  return !/"enabled"\s*:\s*false/.test(result.output);
}

async function writeDmContext(next: boolean): Promise<void> {
  await runCommand(
    `mkdir -p ${DIR} && printf '{"version":1,"enabled":%s}\\n' ${next} > ${DM_CONTEXT_FILE}.tmp && mv ${DM_CONTEXT_FILE}.tmp ${DM_CONTEXT_FILE}`,
    { timeoutMs: 15_000 },
  );
}

async function readOpenbotUiSetting(): Promise<OpenbotUiSetting> {
  const result = await runCommand(`cat ${OPENBOT_UI_FILE} 2>/dev/null || true`, { timeoutMs: 15_000 });
  return parseOpenbotUiSetting(result.output.trim());
}

/** Reads the file, applies the change, writes it back whole (atomic rename), so the other value stays. */
async function saveOpenbotUiSetting(change: Partial<OpenbotUiSetting>): Promise<void> {
  const next = { ...(await readOpenbotUiSetting()), ...change };
  // The JSON holds only true/false and one of three fixed words, so single quotes are safe.
  await runCommand(
    `mkdir -p ${OPENBOT_UI_DIR} && printf '%s\\n' '${openbotUiSettingJson(next)}' > ${OPENBOT_UI_FILE}.tmp && mv ${OPENBOT_UI_FILE}.tmp ${OPENBOT_UI_FILE}`,
    { timeoutMs: 15_000 },
  );
}

export function DmContextSection({ engineInstalled }: { engineInstalled: boolean }) {
  return (
    <EngineJsonSwitch
      engineInstalled={engineInstalled}
      read={readDmContext}
      write={writeDmContext}
      copy={DM_CONTEXT_COPY}
    />
  );
}

const readOpenbotUiEnabled = async () => (await readOpenbotUiSetting()).enabled;
const writeOpenbotUiEnabled = (enabled: boolean) => saveOpenbotUiSetting({ enabled });

export function OpenbotUiSection({ engineInstalled }: { engineInstalled: boolean }) {
  return (
    <EngineJsonSwitch
      engineInstalled={engineInstalled}
      read={readOpenbotUiEnabled}
      write={writeOpenbotUiEnabled}
      copy={OPENBOT_UI_COPY}
    />
  );
}

function EngineJsonSwitch({
  engineInstalled,
  read,
  write,
  copy,
}: {
  engineInstalled: boolean;
  read: () => Promise<boolean>;
  write: (next: boolean) => Promise<void>;
  copy: SwitchCopy;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEnabled(await read());
      setReady(true);
    } catch {
      setReady(true);
    }
  }, [read]);

  useEffect(() => {
    if (engineInstalled) void load();
  }, [engineInstalled, load]);

  const save = async (next: boolean) => {
    setError(null);
    setSaving(true);
    setEnabled(next);
    void haptics.selection();
    try {
      await write(next);
    } catch {
      setEnabled(!next);
      setError(t("mobile.settings.engineSwitch.saveFailed"));
      void haptics.notification("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title={t(copy.title)} footer={error ?? t(copy.footer)}>
      <SettingsRow>
        <SettingsSwitch
          value={enabled}
          disabled={!engineInstalled || !ready || saving}
          label={t(copy.label)}
          dark={theme === "dark"}
          onValueChange={(next) => void save(next)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

const LEVEL_LABELS = {
  low: "mobile.settings.openbotUi.levelLow",
  balanced: "mobile.settings.openbotUi.levelBalanced",
  high: "mobile.settings.openbotUi.levelHigh",
} as const satisfies Record<OpenbotUiLevel, MobileTextKey>;

/**
 * "Rich UI usage" (Settings > Appearance): how readily agents answer with openbot-ui blocks. Off
 * ("Rich UI in replies" in Settings > Local engine) wins: the picker is disabled and says so.
 */
export function OpenbotUiLevelSection() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { status } = useOpenBotEngine();
  const engineInstalled = status.installedVersion != null && status.phase !== "installing";
  const [setting, setSetting] = useState<OpenbotUiSetting>({ enabled: true, level: "balanced" });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!engineInstalled) return;
    let alive = true;
    readOpenbotUiSetting()
      .then((value) => {
        if (alive) setSetting(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [engineInstalled]);

  const change = async (level: OpenbotUiLevel) => {
    const previous = setting.level;
    setError(null);
    setSaving(true);
    setSetting((current) => ({ ...current, level }));
    void haptics.selection();
    try {
      await saveOpenbotUiSetting({ level });
    } catch {
      setSetting((current) => ({ ...current, level: previous }));
      setError(t("mobile.settings.engineSwitch.saveFailed"));
      void haptics.notification("error");
    } finally {
      setSaving(false);
    }
  };

  const footer =
    error ??
    (ready && !setting.enabled
      ? t("mobile.settings.openbotUi.levelOffFooter")
      : t("mobile.settings.openbotUi.levelFooter"));
  return (
    <SettingsSection footer={footer}>
      <SettingsRow
        trailing={
          <SettingsPicker<OpenbotUiLevel>
            value={setting.level}
            options={OPENBOT_UI_LEVELS.map((value) => ({ value, label: t(LEVEL_LABELS[value]) }))}
            enabled={engineInstalled && ready && setting.enabled && !saving}
            dark={theme === "dark"}
            label={t("mobile.settings.openbotUi.level")}
            onChange={(level) => void change(level)}
          />
        }
      >
        <Typography.Paragraph>{t("mobile.settings.openbotUi.level")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
