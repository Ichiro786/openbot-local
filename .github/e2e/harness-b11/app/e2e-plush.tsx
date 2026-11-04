// E2E HARNESS (build11-review-ci, extended build11-2-ci): upstream plush avatars (bloub, Skia frames on
// the UI thread through usePlushFrame) in every mood, animating, plus build 11.2 agent-colors-v1: the 17
// presets + automatic and exact custom hexes (any wheel colour, incl. near-black/near-white), working and
// idle. Buttons flip Settings > Animations "faces" and "all animations" (Reduce Motion) so the run can
// prove frames stop. Two screenshots a second apart prove the faces move.
import { AVATAR_COLOR_CHOICES } from "@openbot/brand/bloub-avatar";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarColor } from "@openbot/contracts/ipc";
import { Pressable, ScrollView, Text, View } from "react-native";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { FakeWorkspace } from "@/e2e/fake-workspace";

const MOODS: AvatarMood[] = ["idle", "working", "waiting", "failed", "responded", "connecting", "asleep"];
const CUSTOM: AvatarColor[] = ["#123456", "#0a0a0a", "#fafafa", "#7fff00", "#c0ffee", "#ff00aa"];
const COLORS = [
  ...AVATAR_COLOR_CHOICES.map((c) => ({ key: c.swatch, hue: c.hue, color: c.color })),
  { key: "auto", hue: null, color: null },
  ...CUSTOM.map((hex) => ({ key: hex, hue: null, color: hex })),
];

export default function E2EPlush() {
  "use no memo";
  const faces = useMotionPreferences((s) => s.agentFaces);
  const all = useMotionPreferences((s) => s.allAnimations);
  const btn = { padding: 8, backgroundColor: "#3b5b7a", borderRadius: 10 } as const;
  // AgentPhoto (upstream) reads the workspace: run 41726795282 hit its provider error without this.
  return (
    <FakeWorkspace>
    <ScrollView style={{ flex: 1, backgroundColor: "#101418" }} contentContainerStyle={{ padding: 16, paddingTop: 80 }}>
      <Text style={{ color: "#fff", fontSize: 16 }}>{`E2E PLUSH OPEN faces=${faces ? 1 : 0} all=${all ? 1 : 0} colors=${COLORS.length}`}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="E2E faces toggle" style={btn} onPress={() => useMotionPreferences.setState({ agentFaces: !faces })}><Text style={{ color: "#fff" }}>faces</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="E2E reduce toggle" style={btn} onPress={() => useMotionPreferences.setState({ allAnimations: !all })}><Text style={{ color: "#fff" }}>reduce</Text></Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
        {MOODS.map((mood, i) => (
          <View key={mood} accessible accessibilityLabel={`plush ${mood}`} style={{ alignItems: "center" }}>
            <BloubAvatarPreview seed={`e2e-seed-${i}`} hue={null} size={72} mood={mood} animateIdle />
            <Text style={{ color: "#9aa0a6", fontSize: 12 }}>{mood}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        {COLORS.map((c, i) => (
          <View key={c.key} accessible accessibilityLabel={`plushcolor ${c.key}`}>
            <BloubAvatarPreview seed={`e2e-seed-${i % 7}`} hue={c.hue} color={c.color} size={44} mood={i % 2 ? "working" : "idle"} animateIdle={i % 2 === 0} />
          </View>
        ))}
      </View>
    </ScrollView>
    </FakeWorkspace>
  );
}
