// E2E HARNESS (build 11.3): the REAL agent chat screen (the route component of /chat/[agentId]) over a
// stand-in workspace. Zoom-opened from the harness home row "E2E Real chat" with the chat route's own
// options and listeners. "E2E REAL OPEN" (top-left, no touches) tells the smoke the screen rendered.
import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";
import { AgentChatScreen } from "@/features/chat/screens/agent-chat-screen";
import { RealWorkspace } from "@/e2e/real-workspace";

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String((error as Error)?.message ?? error) };
  }
  componentDidCatch(error: unknown) {
    console.log(`E2EREAL error ${String((error as Error)?.stack ?? error).slice(0, 600)}`);
  }
  render() {
    if (this.state.error)
      return <Text style={{ color: "#fff", marginTop: 160, marginHorizontal: 16 }}>{`E2E REAL ERROR ${this.state.error}`}</Text>;
    return this.props.children;
  }
}

export default function E2ERealRoute() {
  return (
    <RealWorkspace>
      <Boundary>
        <View style={{ flex: 1 }}>
          <AgentChatScreen />
          <Text pointerEvents="none" style={{ position: "absolute", left: 8, bottom: 140, color: "#888", fontSize: 10 }}>
            E2E REAL OPEN
          </Text>
        </View>
      </Boundary>
    </RealWorkspace>
  );
}
