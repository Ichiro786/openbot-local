import { router } from "expo-router";
import { useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { layoutEvent } from "@/e2e/layout-events";
import { prepareLayoutFixture } from "@/e2e/layout-fixture";
import { RealWorkspace } from "@/e2e/real-workspace";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { armLiveZoom } from "@/shared/motion/liveZoom";

const cases = [
  "short-fresh",
  "short-warm",
  "long-fresh",
  "long-warm",
  "overlap",
  "disconnected",
  "tall",
  "fast",
  "back-opening",
  "mid-animation",
];
function Controls() {
  const row = useRef<View>(null);
  const colorOS = useMotionPreferences((state) => state.colorOSMotion);
  function open(name: string) {
    const agentId = name.startsWith("short") ? "e2e-short" : name.startsWith("long") ? "e2e-long" : "e2e-layout-stress";
    if (!name.endsWith("warm")) globalThis.__e2eLongReset?.();
    prepareLayoutFixture(name, !name.endsWith("warm"), name === "tall");
    layoutEvent("open", { name, agentId, colorOS });
    const go = (y: number) => {
      globalThis.__e2eTap = Date.now();
      if (colorOS) armLiveZoom(y);
      router.push({ pathname: "/e2e-real", params: { agentId } });
    };
    row.current?.measureInWindow((_x, y, _w, height) => go(y + height / 2));
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#151515", paddingTop: 42 }}>
      <View ref={row}>
        <Text style={{ color: "white" }}>{`E2E LAYOUT READY colorOS=${colorOS ? "ON" : "OFF"}`}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Layout toggle"
        onPress={() => useMotionPreferences.setState({ colorOSMotion: !colorOS })}
        style={{ padding: 12 }}
      >
        <Text style={{ color: "white" }}>Layout toggle</Text>
      </Pressable>
      {cases.map((name) => (
        <Pressable
          key={name}
          accessibilityRole="button"
          accessibilityLabel={`Layout ${name}`}
          onPress={() => open(name)}
          style={{ padding: 12 }}
        >
          <Text style={{ color: "white" }}>{`Layout ${name}`}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export default function LayoutRoute() {
  return (
    <RealWorkspace>
      <Controls />
    </RealWorkspace>
  );
}
