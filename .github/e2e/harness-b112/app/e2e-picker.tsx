// E2E HARNESS (build11-2-ci): the real AgentAppearancePicker (+ AgentColorWheel on agent-colors-v1),
// wired like EditAgentScreen: onColorChange saves {hue, color}; the wheel only with ColorOS motion ON
// (Android). A host without agent-colors-v1 (?cap=0) keeps only the nearest hue, as upstream's save path.
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput } from "react-native";
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
  const { cap, save, info } = useLocalSearchParams<{ cap?: string; save?: string; info?: string }>();
  // ?save=1: like the agent Appearance page (EditAgentScreen): an unsaved change guards Back with the
  // discard alert, Save clears it (build 11.2 stuck-Back regression).
  const guarded = save === "1";
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(0);
  // EditAgentScreen guards while saving too (the update is async).
  const [saving, setSaving] = useState(false);
  const [bio, setBio] = useState("E2E bio");
  usePreventRemove(guarded && (dirty || saving), ({ repeat }) => {
    Alert.alert("Discard changes?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => { setDirty(false); repeat(); } },
    ]);
  });
  const supported = cap !== "0";
  const colorOS = useColorOSMotion().enabled && isAndroid;
  const [hue, setHue] = useState<AvatarHue | null>(null);
  const [color, setColor] = useState<AvatarColor | null>(null);
  const [seed, setSeed] = useState(E2E_AGENT.avatarSeed);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#101418" }} contentContainerStyle={{ paddingTop: 60, paddingBottom: 80 }}>
      <Text style={{ color: "#fff", fontSize: 14, marginHorizontal: 16 }}>
        {`PICKER OPEN colorOS=${colorOS ? "ON" : "OFF"} cap=${supported ? 1 : 0} CUSTOM=${color ?? "none"} HUE=${hue ?? "auto"} DIRTY=${dirty ? 1 : 0} SAVED=${saved}`}
      </Text>
      {guarded ? (
        <Pressable accessibilityRole="button" accessibilityLabel="E2E Save" onPress={() => { if (saving) return; setSaving(true); setTimeout(() => { setDirty(false); setSaving(false); setSaved((n) => n + 1); }, 400); }} style={{ margin: 12, padding: 10, backgroundColor: "#2e7d32", borderRadius: 10, alignSelf: "flex-start" }}>
          <Text style={{ color: "#fff" }}>Save</Text>
        </Pressable>
      ) : null}
      {info === "1" ? (
        <TextInput accessibilityLabel="E2E Bio" value={bio} onChangeText={(v) => { setBio(v); setDirty(true); }} style={{ color: "#fff", borderColor: "#555", borderWidth: 1, margin: 12, padding: 8 }} />
      ) : null}
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
          setDirty(true);
        }}
      />
    </ScrollView>
  );
}
