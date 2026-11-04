import * as Clipboard from "expo-clipboard";
import { useRootNavigationState } from "expo-router";
import { useEffect, useReducer, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useText } from "@/shared/lib/text";
import { backHoldCounts, predictiveBack } from "@/shared/motion/predictiveBack";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { zoomClosing } from "@/shared/motion/ZoomCloseOverlay";
import { backEvents, backFlags, formatTime, logBack, useBackDebug } from "./backDebug";

type NavState = { index?: number; routes: { name: string; key: string; state?: NavState }[] } | undefined;

/** One line per navigator, outermost first: route names, the focused one marked with *. */
function describe(state: NavState, lines: string[] = [], depth = 0): string[] {
  if (!state?.routes) return lines;
  const index = state.index ?? state.routes.length - 1;
  lines.push(
    `${"  ".repeat(depth)}[${index}] ${state.routes.map((r, i) => (i === index ? `*${r.name}` : r.name)).join(" > ")}`,
  );
  describe(state.routes[index]?.state, lines, depth + 1);
  return lines;
}

function focusedRoute(state: NavState): string {
  let current = state;
  let route: { name: string; key: string } | undefined;
  while (current?.routes) {
    route = current.routes[current.index ?? current.routes.length - 1];
    current = (route as { state?: NavState } | undefined)?.state;
  }
  return route ? `${route.name} ${route.key}` : "?";
}

function snapshot(state: NavState): string {
  const holds = backHoldCounts();
  return [
    `focused: ${focusedRoute(state)}`,
    ...describe(state),
    `holds chat=${holds.chatHolds} predictive=${holds.predictiveHolds} zoomClosing=${zoomClosing()}`,
    backFlags(),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Build 11.3 Back debug pill: always on top (root overlay), ColorOS ON and Settings › Back debug only. */
export function BackDebugPill() {
  const enabled = useBackDebug((s) => s.enabled);
  const colorOS = useColorOSMotion().enabled;
  if (!enabled || !colorOS) return null;
  return <Pill />;
}

function Pill() {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const state = useRootNavigationState() as unknown as NavState;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const lastStack = useRef("");

  // Navigation state changes, as they happen.
  const stack = describe(state).join(" | ");
  useEffect(() => {
    if (stack === lastStack.current) return;
    lastStack.current = stack;
    logBack("state", `${focusedRoute(state)} :: ${stack}`);
  }, [stack, state]);

  // Live flags, and a hardwareBackPress listener re-added on each tick so it is the newest one (React
  // Native calls the newest first); it never takes the event.
  useEffect(() => {
    let subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      logBack("hardwareBackPress");
      return false;
    });
    const timer = setInterval(() => {
      subscription.remove();
      subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        logBack("hardwareBackPress");
        return false;
      });
      tick();
    }, 500);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  // Native predictive back events (only sent while a chat holds the callback on).
  useEffect(() => {
    if (!predictiveBack) return;
    const module = predictiveBack;
    const subscriptions = [
      module.addListener("onBackStart", ({ edge }) => logBack("predictive start", `edge ${edge}`)),
      module.addListener("onBackCancel", () => logBack("predictive cancel")),
      module.addListener("onBackInvoke", () => logBack("predictive invoke")),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  const recent = backEvents()
    .slice(-5)
    .map((e) => `${formatTime(e.t)} ${e.source} ${e.detail}`.slice(0, 140))
    .join("\n");

  function copy() {
    const log = backEvents()
      .map((e) => `${formatTime(e.t)} ${e.source} ${e.detail}`)
      .join("\n");
    void Clipboard.setStringAsync(`OpenBot Back debug ${new Date().toISOString()}\n${snapshot(state)}\n--- log ---\n${log}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 64 }]}>
      <View style={styles.pill}>
        {open ? (
          <View pointerEvents="none">
            <Text style={styles.text}>{snapshot(state)}</Text>
            <Text style={[styles.text, styles.events]}>{recent}</Text>
          </View>
        ) : null}
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} style={styles.button}>
            <Text style={styles.buttonText}>{open ? t("mobile.settings.backDebug.hide") : t("mobile.settings.backDebug.show")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={copy} style={styles.button}>
            <Text style={styles.buttonText}>
              {copied ? t("mobile.settings.backDebug.copied") : t("mobile.settings.backDebug.copy")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 6, right: 6, alignItems: "flex-end", zIndex: 10000, elevation: 10000 },
  pill: { maxWidth: "88%", backgroundColor: "rgba(0,0,0,0.78)", borderRadius: 12, padding: 6 },
  text: { color: "#fff", fontSize: 9, lineHeight: 11, fontFamily: "monospace" },
  events: { color: "#9fe8a0", marginTop: 3 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 4 },
  button: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.18)" },
  buttonText: { color: "#fff", fontSize: 11 },
});
