// OpenBot Local (build 8): "Share DM context in group chats". The engine patch (engine-0.59.0-2)
// reads /root/.openbot-local/dm-context.json inside the rootfs on every channel turn; a missing file
// means ON. Saving writes that file through the engine's command runner, so the next channel turn
// picks it up without a restart. Engines older than 0.59.0-2 ignore the file.
import { useCallback, useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { runCommand } from "../../../modules/openbot-engine";

const DIR = "/root/.openbot-local";
const FILE = `${DIR}/dm-context.json`;

export function DmContextSection({ engineInstalled }: { engineInstalled: boolean }) {
  const { theme } = useUniwind();
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await runCommand(`cat ${FILE} 2>/dev/null || true`, { timeoutMs: 15_000 });
      // Default ON: only an explicit {"enabled": false} turns it off, as in the engine.
      setEnabled(!/"enabled"\s*:\s*false/.test(result.output));
      setReady(true);
    } catch {
      setReady(true);
    }
  }, []);

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
        `mkdir -p ${DIR} && printf '{"version":1,"enabled":%s}\\n' ${next} > ${FILE}.tmp && mv ${FILE}.tmp ${FILE}`,
        {
          timeoutMs: 15_000,
        },
      );
    } catch {
      setEnabled(!next);
      setError("Could not save. Start the engine and try again.");
      void haptics.notification("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Group chats"
      footer={
        error ??
        "Agents bring a short summary of your DM with them (up to 1.5 KB) and the memories that fit the request into group chats on this phone's engine. Before an agent's first group-chat turn it reviews your DM into its memories. People who can read the group chat may see what the agent repeats."
      }
    >
      <SettingsRow>
        <SettingsSwitch
          value={enabled}
          disabled={!engineInstalled || !ready || saving}
          label="Share DM context in group chats"
          dark={theme === "dark"}
          onValueChange={(next) => void save(next)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
