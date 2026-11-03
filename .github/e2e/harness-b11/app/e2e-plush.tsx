// E2E HARNESS (build11-review-ci): upstream v0.60's plush avatars (bloub 0.6.3, Skia frames on the UI
// thread through usePlushFrame) in every mood, animating, so a worklet or Skia crash in the merge shows
// up, and two screenshots a second apart prove the faces move.
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { ScrollView, Text, View } from "react-native";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { FakeWorkspace } from "@/e2e/fake-workspace";

const MOODS: AvatarMood[] = ["idle", "working", "waiting", "failed", "responded", "connecting", "asleep"];

export default function E2EPlush() {
  // AgentPhoto (upstream) reads the workspace: run 41726795282 hit its provider error without this.
  return (
    <FakeWorkspace>
    <ScrollView style={{ flex: 1, backgroundColor: "#101418" }} contentContainerStyle={{ padding: 16, paddingTop: 80 }}>
      <Text style={{ color: "#fff", fontSize: 16 }}>E2E PLUSH OPEN</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
        {MOODS.map((mood, i) => (
          <View key={mood} accessible accessibilityLabel={`plush ${mood}`} style={{ alignItems: "center" }}>
            <BloubAvatarPreview seed={`e2e-seed-${i}`} hue={null} size={88} mood={mood} animateIdle />
            <Text style={{ color: "#9aa0a6", fontSize: 12 }}>{mood}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
    </FakeWorkspace>
  );
}
