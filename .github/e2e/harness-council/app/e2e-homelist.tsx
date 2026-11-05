// E2E HARNESS (council-frames, judge 1): the REAL home row (AgentListRow: BloubAvatar 54 + rings, press
// highlight, hold menu) x40 in an Animated.FlatList with the home list's own props (connected-screen.tsx
// 912-950: batch 10, window 7, removeClippedSubviews false, scrollEventThrottle 16) inside a BlurTargetView.
// Stand-in workspace (signed out). "E2E HOMELIST OPEN" tells the smoke it rendered. Scroll only (no tap).
import { BlurTargetView } from "expo-blur";
import { Component, type ReactNode, useRef } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { AgentListRow } from "@/features/agents/components/agent-list-row";
import { AgentPinTransitionProvider } from "@/features/agents/components/agent-pin-transition";
import { ChatDragProvider } from "@/features/agents/components/chat-drag";
import { WorkspaceContexts } from "@/features/workspace/context/workspace-store";

const anything: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === Symbol.iterator) return function* () {};
    if (key === Symbol.toPrimitive) return () => "";
    if (key === "then") return undefined;
    if (key === "length") return 0;
    return anything;
  },
  apply: () => anything,
});
const NAMES = ["VEYR", "Atlas", "Nova", "Orbit", "Quill", "Sage", "Echo", "Pixel"];
const AGENTS = Array.from({ length: 40 }, (_, i) => ({
  id: `e2e-home-${i}`,
  serverId: "e2e-server",
  name: `${NAMES[i % NAMES.length]} ${i + 1}`,
  title: i % 3 === 0 ? "Review helper" : "",
  description: "",
  preview: i % 2 ? "The build **failed** at the Gradle configure step, re-running now." : "Sure, here is the summary you asked for.",
  updatedLabel: "",
  avatarSeed: `e2e-seed-${i}`,
  avatarHue: null,
  avatarColor: null,
  avatarUrl: null,
  pinned: false,
}));
const server = { id: "e2e-server", name: "E2E", status: "online", online: true, connected: true, initialConnectionPending: false };
const liveSnapshot = { activityByServer: {}, approvalRequests: {}, browserRequests: {}, browserTabs: {}, turnLinesByServer: {}, unreadAgentIds: [], unreadCounts: {} };
const known: Record<string, unknown> = {
  agents: AGENTS,
  servers: [server],
  activeServer: server,
  liveState: { get: () => liveSnapshot, subscribe: () => () => undefined },
  pinnedAgentIds: [],
  pinnedChannelIds: [],
  canUseTasks: () => true,
};
const value: any = new Proxy({}, { get: (_t, key) => (typeof key === "string" && key in known ? known[key] : anything) });
const channelState = { channels: [], loaded: true };
const knownActions: Record<string, unknown> = {
  channelStore: { subscribe: () => () => undefined, get: () => channelState, observe: () => undefined },
};
const actions: any = new Proxy({}, { get: (_t, key) => (typeof key === "string" && key in knownActions ? knownActions[key] : anything) });
const dragScreen: any = { items: AGENTS.map((a) => ({ kind: "agent", id: a.id, agent: a })), pins: [], collapsedSectionIds: [], sections: false, canPin: () => false };

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String((error as Error)?.message ?? error) };
  }
  componentDidCatch(error: unknown) {
    console.log(`E2EHOME error ${String((error as Error)?.stack ?? error).slice(0, 600)}`);
  }
  render() {
    if (this.state.error) return <Text style={{ color: "#fff", marginTop: 160, marginHorizontal: 16 }}>{`E2E HOMELIST ERROR ${this.state.error}`}</Text>;
    return this.props.children;
  }
}

export default function E2EHomeList() {
  const target = useRef<View>(null);
  return (
    <WorkspaceContexts value={value} actions={actions}>
      <Boundary>
        <AgentPinTransitionProvider>
          <BlurTargetView ref={target as any} style={{ flex: 1, backgroundColor: "#000" }}>
            <ChatDragProvider screen={dragScreen}>
              <Animated.FlatList
                data={AGENTS}
                keyExtractor={(a) => a.id}
                renderItem={({ item }) => <AgentListRow agent={item as any} leftInset={15} rightInset={24} />}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={7}
                removeClippedSubviews={false}
                scrollEventThrottle={16}
                contentContainerStyle={{ paddingTop: 100, paddingBottom: 120 }}
              />
            </ChatDragProvider>
          </BlurTargetView>
          <Text pointerEvents="none" style={{ position: "absolute", left: 8, top: 40, color: "#888", fontSize: 10 }}>
            E2E HOMELIST OPEN
          </Text>
        </AgentPinTransitionProvider>
      </Boundary>
    </WorkspaceContexts>
  );
}
