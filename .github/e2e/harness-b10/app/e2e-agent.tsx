// E2E HARNESS agent page (build10-review-ci only): the real AgentPageHero (Cue-style top of the agent
// page) in a full-screen card route with the same options the real agent page takes with ColorOS on.
import { router, Stack } from "expo-router";
import { Pressable, ScrollView, Text } from "react-native";
import { AgentPageHero } from "@/features/agents/components/agent-page-hub";
import { E2E_AGENT, FakeWorkspace } from "@/e2e/fake-workspace";

export default function E2EAgentPage() {
  return (
    <FakeWorkspace>
      {/* cbe09e95+: the agent page keeps an untitled native bar with the stack Back (no hero Back). */}
      <Stack.Screen options={{ headerShown: true, title: "" }} />
      <ScrollView style={{ flex: 1, backgroundColor: "#101418" }} contentContainerStyle={{ padding: 16 }}>
        <AgentPageHero agent={E2E_AGENT as never} avatarSeed={E2E_AGENT.avatarSeed} avatarHue={E2E_AGENT.avatarHue as never} available />
        <Text style={{ color: "#fff", marginTop: 24 }}>E2E AGENT PAGE OPEN</Text>
        {/* Build 11.2 stuck-Back regression: the Appearance page with a guarded Save, pushed from here. */}
        <Pressable accessibilityRole="button" accessibilityLabel="E2E Appearance" onPress={() => router.push("/e2e-picker?save=1")} style={{ marginTop: 12, padding: 10, backgroundColor: "#7a5b3b", borderRadius: 10, alignSelf: "flex-start" }}>
          <Text style={{ color: "#fff" }}>Appearance</Text>
        </Pressable>
      </ScrollView>
    </FakeWorkspace>
  );
}
