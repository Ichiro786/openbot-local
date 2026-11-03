import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearLastCrash, readLastCrash, recordJsCrash } from "@/shared/lib/crash-log";
import { useText } from "@/shared/lib/text";

/**
 * Crash capture UI. It uses only React Native views and fixed colours, because the root error
 * boundary renders outside every app provider (theme, HeroUI, uniwind).
 */
function palette(dark: boolean) {
  return dark
    ? { bg: "#0b0b0c", card: "#1b1b1d", text: "#f2f2f2", muted: "#a1a1a6", button: "#f2f2f2", buttonText: "#111111" }
    : { bg: "#f6f6f7", card: "#ffffff", text: "#141414", muted: "#5c5c60", button: "#141414", buttonText: "#ffffff" };
}

function Button({
  label,
  primary,
  colors,
  onPress,
}: {
  label: string;
  primary?: boolean;
  colors: ReturnType<typeof palette>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: colors.button }
          : { borderColor: colors.muted, borderWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: primary ? colors.buttonText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The root error boundary screen (expo-router `ErrorBoundary` of the root layout). It saves the
 * error, shows the log, and offers Copy crash log and Try again.
 */
export function CrashScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { t } = useText();
  const colors = palette(useColorScheme() === "dark");
  const [log, setLog] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setLog(recordJsCrash(error, { fatal: false }));
  }, [error]);
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={styles.screen}>
        <Text style={[styles.title, { color: colors.text }]}>{t("mobile.settings.crash.boundaryTitle")}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{t("mobile.settings.crash.boundaryBody")}</Text>
        <ScrollView style={[styles.log, { backgroundColor: colors.card }]}>
          <Text selectable style={[styles.logText, { color: colors.muted }]}>
            {log}
          </Text>
        </ScrollView>
        <View style={styles.row}>
          <Button
            primary
            colors={colors}
            label={copied ? t("mobile.settings.crash.copied") : t("mobile.settings.crash.copy")}
            onPress={() => {
              void Clipboard.setStringAsync(log).then(() => setCopied(true));
            }}
          />
          <Button colors={colors} label={t("mobile.settings.crash.retry")} onPress={() => void retry()} />
        </View>
      </View>
    </View>
  );
}

/** On the launch after a crash: a card at the bottom with Copy crash log and Dismiss. */
export function LastCrashNotice() {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const colors = palette(useColorScheme() === "dark");
  const [log, setLog] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setLog(readLastCrash());
  }, []);
  if (!log) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, styles.noticeHost, { paddingBottom: insets.bottom + 12 }]}
    >
      <View style={[styles.notice, { backgroundColor: colors.card }]}>
        <Text style={[styles.noticeTitle, { color: colors.text }]}>{t("mobile.settings.crash.lastTitle")}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{t("mobile.settings.crash.lastBody")}</Text>
        <View style={styles.row}>
          <Button
            primary
            colors={colors}
            label={copied ? t("mobile.settings.crash.copied") : t("mobile.settings.crash.copy")}
            onPress={() => {
              void Clipboard.setStringAsync(log).then(() => setCopied(true));
            }}
          />
          <Button
            colors={colors}
            label={t("mobile.settings.crash.dismiss")}
            onPress={() => {
              clearLastCrash();
              setLog(null);
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 72, paddingBottom: 32, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  log: { flex: 1, borderRadius: 16, padding: 12 },
  logText: { fontSize: 12, lineHeight: 16, fontFamily: "monospace" },
  row: { flexDirection: "row", gap: 10, marginTop: 4 },
  button: { flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: 15, fontWeight: "600" },
  noticeHost: { justifyContent: "flex-end", paddingHorizontal: 12, zIndex: 1000, elevation: 1000 },
  notice: { borderRadius: 24, padding: 16, gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" },
  noticeTitle: { fontSize: 17, fontWeight: "600" },
});
