import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { AvatarSizeSlider } from "@/features/settings/components/avatar-size-slider";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveAppearance, useAppearance } from "@/features/settings/model/appearance";
import { saveAgentColorMessages, useAgentColorMessages } from "@/features/settings/model/message-color";
import { dynamicColorSupported, saveThemeStyle, useThemeStyle } from "@/features/settings/model/theme-style";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";

export function AppearanceSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { value, ready, saving } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const agentColorMessages = useAgentColorMessages();
  const [agentColorError, setAgentColorError] = useState<string | null>(null);
  const themeStyle = useThemeStyle();
  const [themeStyleError, setThemeStyleError] = useState<string | null>(null);
  const [dynamicAvailable] = useState(dynamicColorSupported);
  const themeStyleBusy = !themeStyle.ready || themeStyle.saving;
  const colorOS = useColorOSMotion().enabled;

  function saveStyle(change: Parameters<typeof saveThemeStyle>[0]) {
    setThemeStyleError(null);
    void haptics.selection();
    void saveThemeStyle(change).catch(() => {
      setThemeStyleError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

  return (
    <SettingsContent>
      <SettingsSection footer={error || t("mobile.settings.appearance.footer")}>
        <SettingsRow
          trailing={
            <SettingsPicker
              value={value}
              options={[
                { value: "system", label: t("mobile.settings.appearance.system") },
                { value: "light", label: t("mobile.settings.appearance.light") },
                { value: "dark", label: t("mobile.settings.appearance.dark") },
              ]}
              enabled={ready && !saving}
              dark={theme === "dark"}
              label={t("mobile.settings.appearance.theme")}
              onChange={(next) => {
                setError(null);
                void haptics.selection();
                void saveAppearance(next).catch(() => {
                  setError(t("mobile.settings.appearance.saveFailed"));
                  void haptics.notification("error");
                });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.theme")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {/* OpenBot Local: AMOLED black and Material You. Both apply at once, across every screen. */}
      <SettingsSection
        title="Colors"
        footer={
          themeStyleError ??
          (isAndroid && dynamicAvailable
            ? "Pure black uses #000000 backgrounds while the dark theme shows, which saves power on OLED screens. Material You takes the accent color from your wallpaper."
            : "Pure black uses #000000 backgrounds while the dark theme shows, which saves power on OLED screens. Material You colors need Android 12 or newer.")
        }
      >
        <SettingsRow>
          <SettingsSwitch
            value={themeStyle.amoled}
            disabled={themeStyleBusy}
            label="Pure black (AMOLED)"
            dark={theme === "dark"}
            onValueChange={(amoled) => saveStyle({ amoled })}
          />
        </SettingsRow>
        {isAndroid ? (
          <SettingsRow>
            <SettingsSwitch
              value={dynamicAvailable && themeStyle.dynamicColor}
              disabled={themeStyleBusy || !dynamicAvailable}
              label="Material You colors"
              dark={theme === "dark"}
              onValueChange={(dynamicColor) => saveStyle({ dynamicColor })}
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {/* Build 11.3 (ColorOS ON): agent avatar size, app-wide. */}
      {colorOS ? (
        <SettingsSection footer={t("mobile.settings.appearance.avatarSizeFooter")}>
          <SettingsRow>
            <AvatarSizeSlider seed="openbot-avatar-size" hue={null} />
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <SettingsSection footer={agentColorError ?? t("mobile.settings.appearance.agentColorMessagesFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={agentColorMessages.enabled}
            disabled={!agentColorMessages.ready || agentColorMessages.saving}
            label={t("mobile.settings.appearance.agentColorMessages")}
            dark={theme === "dark"}
            onValueChange={(enabled) => {
              setAgentColorError(null);
              void saveAgentColorMessages(enabled).catch(() => {
                setAgentColorError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
