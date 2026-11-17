// OpenBot Local (build 17): "Always on". Off (the default) lets PowerGovernor release the wake lock while
// no agent works; on keeps the phone awake the whole time the engine runs (the behaviour before build 17).
// The setting lives in the native engine config, and a running engine follows it at once.
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { getConfig, setConfig } from "../../../modules/openbot-engine";

export function AlwaysOnSection() {
  const { t } = useText();
  const { theme } = useUniwind();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getConfig()
      .then((config) => {
        if (alive) setEnabled(config?.keepAwake ?? false);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: boolean) => {
    setError(null);
    setSaving(true);
    setEnabled(next);
    void haptics.selection();
    try {
      const config = await setConfig({ keepAwake: next });
      setEnabled(config?.keepAwake ?? next);
    } catch {
      setEnabled(!next);
      setError(t("mobile.settings.alwaysOn.saveFailed"));
      void haptics.notification("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title={t("mobile.settings.alwaysOn.title")} footer={error ?? t("mobile.settings.alwaysOn.footer")}>
      <SettingsRow>
        <SettingsSwitch
          value={enabled}
          disabled={!ready || saving}
          label={t("mobile.settings.alwaysOn.label")}
          dark={theme === "dark"}
          onValueChange={(next) => void save(next)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
