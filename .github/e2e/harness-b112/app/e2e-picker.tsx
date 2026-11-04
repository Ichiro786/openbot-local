// E2E HARNESS (build11-2-ci): the real AgentAppearancePicker (+ AgentColorWheel on agent-colors-v1),
// wired like EditAgentScreen: onColorChange saves {hue, color}; the wheel only with ColorOS motion ON
// (Android). A host without agent-colors-v1 (?cap=0) keeps only the nearest hue, as upstream's save path.
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { isAndroid } from "@/shared/lib/platform";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { E2E_AGENT, FakeWorkspace } from "@/e2e/fake-workspace";

export default function E2EPickerRoute() {
  return (
    <FakeWorkspace>
      <E2EPicker />
    </FakeWorkspace>
  );
}

function E2EPicker() {
  "use no memo";
  const { cap } = useLocalSearchParams<{ cap?: string }>();
  const supported = cap !== "0";
  const colorOS = useColorOSMotion().enabled && isAndroid;
  const [hue, setHue] = useState<AvatarHue | null>(null);
  const [color, setColor] = useState<AvatarColor | null>(null);
  const [seed, setSeed] = useState(E2E_AGENT.avatarSeed);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#101418" }} contentContainerStyle={{ paddingTop: 60, paddingBottom: 80 }}>
      <Text style={{ color: "#fff", fontSize: 14, marginHorizontal: 16 }}>
        {`PICKER OPEN colorOS=${colorOS ? "ON" : "OFF"} cap=${supported ? 1 : 0} CUSTOM=${color ?? "none"} HUE=${hue ?? "auto"}`}
      </Text>
      <AgentAppearancePicker
        agentId={E2E_AGENT.id}
        serverId={E2E_AGENT.serverId}
        seed={seed}
        hue={hue}
        color={color}
        name={E2E_AGENT.name}
        nameField={null}
        disabled={false}
        onSeedChange={setSeed}
        onColorChange={(next) => {
          setHue(next.hue);
          setColor(supported ? next.color : null);
        }}
      />
    </ScrollView>
  );
}
