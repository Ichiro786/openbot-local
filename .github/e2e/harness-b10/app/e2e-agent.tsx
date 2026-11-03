// E2E HARNESS agent page (build10-review-ci only): the real AgentPageHero (Cue-style top of the agent
// page) in a full-screen card route with the same options the real agent page takes with ColorOS on.
import { Stack } from "expo-router";
import { ScrollView, Text } from "react-native";
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
      </ScrollView>
    </FakeWorkspace>
  );
}
