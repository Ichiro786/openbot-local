// E2E HARNESS chat (build10-review-ci only). The real ChatMessageGesture + ChatMessageActions +
// openMessageMenu (glass menu with the reaction bar) on one agent and one own message, the real
// useChatMotion composer lift and the real ChatComposer (frosted from this screen's BlurTargetView).
// A reaction is checked with the host's own validator (isMessageReaction) and shown on screen.
import { isMessageReaction } from "@openbot/contracts/ipc";
import { BlurTargetView } from "expo-blur";
import { router, Stack } from "expo-router";
import { Pressable } from "react-native";
import { useRef, useState } from "react";
import { Text, View, type ViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatMessageActions, type MessageActionsControl } from "@/features/chat/components/chat-message-actions";
import { ChatMessageGesture } from "@/features/chat/components/chat-message-gesture";
import { openMessageMenu } from "@/features/chat/components/chat-message-menu";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import { useFrostTarget } from "@/shared/motion/frostTarget";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { AgentPageHero } from "@/features/agents/components/agent-page-hub";
import { E2E_AGENT, FakeWorkspace } from "@/e2e/fake-workspace";
void AgentPageHero;

type Msg = { id: string; author: "agent" | "user"; text: string };
const MESSAGES: Msg[] = [
  { id: "a1", author: "agent", text: "E2E agent message: hold me to react." },
  { id: "u1", author: "user", text: "E2E own message" },
];

export default function E2EChatRoute() {
  return (
    <FakeWorkspace>
      <E2EChat />
    </FakeWorkspace>
  );
}

function E2EChat() {
  "use no memo";
  const insets = useSafeAreaInsets();
  const colorOS = useColorOSMotion().enabled;
  const target = useRef<ViewInstance | null>(null);
  useFrostTarget(target, colorOS);
  const motion = useChatMotion(0, Math.max(insets.bottom, 10) - 10, true, true, "u1");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("none");
  const [reacted, setReacted] = useState<Record<string, string | null>>({});
  const [log, setLog] = useState("none");
  // Hooks at the top level: React Compiler memoised the object literal, so its useRef calls ran only on
  // the first render ("Rendered fewer hooks than expected", run 41676402080).
  const a1Control = useRef<MessageActionsControl | null>(null);
  const u1Control = useRef<MessageActionsControl | null>(null);
  const controls = { a1: a1Control, u1: u1Control };
  const react = async (id: string, emoji: string | null) => {
    setReacted((r) => ({ ...r, [id]: emoji }));
    setLog(`REACTED ${id} ${emoji ?? "null"} valid=${emoji === null || isMessageReaction(emoji)}`);
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#101418" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <BlurTargetView ref={target} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingTop: insets.top + 96, paddingHorizontal: 12 }}>
          <Text style={{ color: "#fff", fontSize: 16 }}>{`E2E CHAT OPEN colorOS=${colorOS ? "ON" : "OFF"}`}</Text>
          <Text style={{ color: "#fff", fontSize: 14 }}>{log}</Text>
          <Text style={{ color: "#fff", fontSize: 14 }}>{`SENT=${sent.replaceAll("\n", "\\n")}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="E2E Open agent page" onPress={() => router.push("/e2e-agent")} style={{ marginTop: 6, padding: 8, backgroundColor: "#34495e", borderRadius: 8, alignSelf: "flex-start" }}>
            <Text style={{ color: "#fff" }}>Open agent page</Text>
          </Pressable>
          {MESSAGES.map((m) => {
            const own = m.author === "user";
            const openMenu = colorOS
              ? (x: number, y: number) =>
                  openMessageMenu({
                    x,
                    y,
                    title: "3:17 pm",
                    icon: "#fff",
                    labels: {
                      reply: "Reply",
                      copy: "Copy message",
                      selectText: "Select text",
                      react: (e) => `React with ${e}`,
                      moreEmoji: "More emoji",
                    },
                    own: controls[m.id as "a1"].current?.own ?? null,
                    onReply: () => setLog(`REPLY ${m.id}`),
                    onCopy: () => setLog(`COPY ${m.id}`),
                    onSelectText: () => setLog(`SELECT ${m.id}`),
                    onReact: (e) => controls[m.id as "a1"].current?.react(e),
                  })
              : undefined;
            return (
              <View key={m.id} style={{ marginTop: 18, alignItems: own ? "flex-end" : "flex-start" }}>
                <ChatMessageGesture
                  align={own ? "end" : "start"}
                  selecting={false}
                  onReply={() => setLog(`SWIPE REPLY ${m.id}`)}
                  onSelectText={() => setLog(`SELECT ${m.id}`)}
                  onHold={openMenu}
                >
                  <View
                    accessible
                    accessibilityLabel={m.text}
                    style={{ padding: 14, borderRadius: 18, maxWidth: 300, backgroundColor: own ? "#e74c3c" : "#2a2f36" }}
                  >
                    <Text style={{ color: "#fff", fontSize: 16 }}>{m.text}</Text>
                  </View>
                </ChatMessageGesture>
                <ChatMessageActions
                  align={own ? "end" : "start"}
                  copyText={m.text}
                  createdAt={new Date(2026, 10, 3, 15, 17).toISOString()}
                  reactions={reacted[m.id] ? [{ emoji: reacted[m.id] as string, actor: { kind: "user" } }] : undefined}
                  agentsById={new Map()}
                  onReact={(e) => react(m.id, e)}
                  onReply={() => setLog(`ROW REPLY ${m.id}`)}
                  onSelectText={() => setLog(`ROW SELECT ${m.id}`)}
                  selecting={false}
                  longPressMenu={colorOS}
                  controlRef={controls[m.id as "a1"]}
                />
              </View>
            );
          })}
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={{ height: 36, marginTop: 8, borderRadius: 8, backgroundColor: i % 2 ? "#e0525a" : "#4fb06d" }} />
          ))}
        </View>
      </BlurTargetView>
      <ChatHeader
        target={{ kind: "agent", id: E2E_AGENT.id, serverId: E2E_AGENT.serverId, name: E2E_AGENT.name, avatarSeed: E2E_AGENT.avatarSeed, avatarHue: E2E_AGENT.avatarHue as never }}
        fallbackBackground="#1f2328"
        foreground="#ffffff"
        liquidGlassAvailable={false}
        topInset={insets.top}
        onBack={() => router.back()}
        accessibilityHidden={false}
        frostTarget={colorOS ? target : undefined}
      />
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]}>
        <ChatComposer
          action="#ffffff"
          actionForeground="#000000"
          agentName="E2E Agent"
          mentionAgents={[]}
          bottomInset={insets.bottom}
          disabled={false}
          draft={draft}
          fallbackBackground="#1f2328"
          foreground="#ffffff"
          liquidGlassAvailable={false}
          muted="#9aa0a6"
          raised="#2a2f36"
          onChangeDraft={setDraft}
          onSend={(text) => {
            setSent(text);
            setDraft("");
          }}
          keyboardProgress={motion.keyboardProgress}
          frostTarget={colorOS ? target : undefined}
          onInputFocus={motion.anticipateKeyboard}
          sendRetryVersion={0}
          replyTarget={null}
          replyFocusVersion={0}
          onCancelReply={() => undefined}
        />
      </Animated.View>
    </View>
  );
}
