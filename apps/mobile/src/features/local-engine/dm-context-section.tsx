// OpenBot Local (build 8): "Share DM context in group chats". The engine patch (engine-0.59.0-2)
// reads /root/.openbot-local/dm-context.json inside the rootfs on every channel turn; a missing file
// means ON. Saving writes that file through the engine's command runner, so the next channel turn
// picks it up without a restart. Engines older than 0.59.0-2 ignore the file.
// Build 15: "Rich UI in replies" is the same kind of switch over openbot-ui.json (engine-0.70.0-2,
// patch 0004: the openbot-ui guide in every agent's instructions; docs/openbot-ui.md).
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useCallback, useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { runCommand } from "../../../modules/openbot-engine";

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

export function DmContextSection({ engineInstalled }: { engineInstalled: boolean }) {
  return <EngineJsonSwitch engineInstalled={engineInstalled} file={`${DIR}/dm-context.json`} copy={DM_CONTEXT_COPY} />;
}

export function OpenbotUiSection({ engineInstalled }: { engineInstalled: boolean }) {
  return <EngineJsonSwitch engineInstalled={engineInstalled} file={`${DIR}/openbot-ui.json`} copy={OPENBOT_UI_COPY} />;
}

function EngineJsonSwitch({
  engineInstalled,
  file,
  copy,
}: {
  engineInstalled: boolean;
  file: string;
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
      const result = await runCommand(`cat ${file} 2>/dev/null || true`, { timeoutMs: 15_000 });
      // Default ON: only an explicit {"enabled": false} turns it off, as in the engine.
      setEnabled(!/"enabled"\s*:\s*false/.test(result.output));
      setReady(true);
    } catch {
      setReady(true);
    }
  }, [file]);

  useEffect(() => {
    if (engineInstalled) void load();
  }, [engineInstalled, load]);

  const save = async (next: boolean) => {
    setError(null);
    setSaving(true);
    setEnabled(next);
    void haptics.selection();
    try {
      await runCommand(
        `mkdir -p ${DIR} && printf '{"version":1,"enabled":%s}\\n' ${next} > ${file}.tmp && mv ${file}.tmp ${file}`,
        {
          timeoutMs: 15_000,
        },
      );
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
