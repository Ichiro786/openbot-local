// E2E HARNESS (build11-2-ci): the REAL ChatMessageList (Legend List, arrivals/entrances, streaming
// reveal), useChatMotion (keyboard lift, send scroll) and ChatComposer (frost), with the ColorOS
// header band, inside FakeWorkspace. Send: beginSend + Keyboard.dismiss + a user row (as ChatView's
// deliver), then a waiting turn, then a reply streamed in 6 chunks. Measures for the smoke:
//   E2EKB shows=N backsteps=N maxBack=dp  (keyboard lift: composer height must never step back)
//   E2ELIST sent=N replied=N              (on screen)
import { BlurTargetView } from "expo-blur";
import { router, Stack } from "expo-router";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { Keyboard, Text, View, type ViewInstance } from "react-native";
import Animated, { runOnJS, useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { E2E_AGENT, FakeWorkspace } from "@/e2e/fake-workspace";

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String((error as Error)?.message ?? error) };
  }
  render() {
    if (this.state.error)
      return <Text style={{ color: "#fff", marginTop: 120, marginHorizontal: 16 }}>{`E2E LIST ERROR ${this.state.error}`}</Text>;
    return this.props.children;
  }
}

export default function E2EListRoute() {
  return (
    <FakeWorkspace>
      <Boundary>
        <E2EList />
      </Boundary>
    </FakeWorkspace>
  );
}

const OLD: ChatMessage[] = Array.from({ length: 8 }, (_, i) => ({
  id: `old${i}`,
  kind: "message",
  author: i % 2 ? "agent" : "user",
  body: i % 2 ? `Old agent reply ${i}: an earlier answer that should not animate when the chat opens.` : `Old question ${i}`,
  streaming: false,
  status: "completed",
}));
const REPLY = ["Sure, ", "here is ", "a streamed ", "reply that ", "arrives in ", "six chunks."];
const target = {
  kind: "agent" as const,
  id: E2E_AGENT.id,
  serverId: E2E_AGENT.serverId,
  name: E2E_AGENT.name,
  avatarSeed: E2E_AGENT.avatarSeed,
  avatarHue: E2E_AGENT.avatarHue as never,
  // Build 11.2: an exact agent-colors-v1 colour, so the activity row's plush draws a custom hex.
  avatarColor: "#123456" as never,
};

function E2EList() {
  "use no memo";
  const insets = useSafeAreaInsets();
  const colorOS = useColorOSMotion().enabled;
  const frost = useRef<ViewInstance | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(OLD);
  const [draft, setDraft] = useState("");
  const [awaiting, setAwaiting] = useState(false);
  const [rowsShown, setRowsShown] = useState(false);
  const [stats, setStats] = useState({ sent: 0, replied: 0 });
  useEffect(() => {
    const id = setTimeout(() => setRowsShown(true), 50);
    return () => clearTimeout(id);
  }, []);
  const keyboardOffset = Math.max(insets.bottom, 10) - 10;
  const lastUser = messages.findLast((m) => m.kind === "message" && m.author === "user")?.id ?? null;
  const motion = useChatMotion(insets.top + 96, keyboardOffset, rowsShown, true, lastUser);
  // Keyboard lift check: while the keyboard shows, the composer's lift must only go up.
  const peak = useSharedValue(0);
  const shows = useSharedValue(0);
  const backs = useSharedValue(0);
  const maxBack = useSharedValue(0);
  const [kb, setKb] = useState("E2EKB shows=0 backsteps=0 maxBack=0");
  const report = (text: string) => {
    setKb(text);
    console.log(text);
  };
  // A back-step: the lift fell during a show and then rose again (a hide falls to 0 without rising).
  const dip = useSharedValue(0);
  useAnimatedReaction(
    () => motion.keyboardHeight.get(),
    (h, prev) => {
      const ph = prev ?? 0;
      if (h <= 0.5) {
        peak.set(0);
        dip.set(0);
      } else if (ph <= 0.5) {
        shows.set(shows.get() + 1);
        peak.set(h);
      } else if (h > ph) {
        if (dip.get() > 0.5) {
          backs.set(backs.get() + 1);
          maxBack.set(Math.max(maxBack.get(), dip.get()));
        }
        dip.set(0);
        peak.set(Math.max(peak.get(), h));
      } else if (h < ph) {
        dip.set(Math.max(dip.get(), peak.get() - h));
      }
      if (h !== ph) runOnJS(report)(`E2EKB shows=${shows.get()} backsteps=${backs.get()} maxBack=${maxBack.get().toFixed(1)}`);
    },
  );
  const send = (text: string) => {
    const n = stats.sent + 1;
    motion.beginSend();
    Keyboard.dismiss();
    setDraft("");
    setAwaiting(true);
    setMessages((m) => [...m, { id: `u${n}`, kind: "message", author: "user", body: text, streaming: false, status: "completed" }]);
    setStats((s) => ({ ...s, sent: n }));
    setTimeout(() => {
      setAwaiting(false);
      let i = 0;
      const step = () => {
        i += 1;
        const done = i >= REPLY.length;
        setMessages((m) => [
          ...m.filter((x) => x.id !== `a${n}`),
          { id: `a${n}`, kind: "message", author: "agent", body: REPLY.slice(0, i).join(""), streaming: !done, status: done ? "completed" : "streaming" } as ChatMessage,
        ]);
        if (done) setStats((s) => ({ ...s, replied: n }));
        else setTimeout(step, 140);
      };
      step();
    }, 900);
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#101418" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <BlurTargetView ref={frost} style={{ flex: 1 }}>
        <ChatMessageList
          {...({} as never)}
          agents={[E2E_AGENT as never]}
          rowsShown={rowsShown}
          target={target as never}
          motion={motion}
          sending={false}
          awaitingTurn={awaiting}
          keyboardOffset={keyboardOffset}
          canSend
          online
          appActive
          activeTurnId={null}
          fieldBackground="#1f2328"
          foreground="#ffffff"
          historyState="ready"
          messages={messages}
          messageAliases={new Map()}
          referenceMessages={[]}
          hasOlder={false}
          olderLoading={false}
          olderError={false}
          onLoadOlder={() => undefined}
          muted="#9aa0a6"
          raised="#2a2f36"
          showStarter={false}
          topInset={insets.top}
          onDismissStarter={() => undefined}
          onSelectStarter={() => undefined}
          onRetryHistory={() => undefined}
        />
      </BlurTargetView>
      <ChatHeader
        target={target as never}
        fallbackBackground="#1f2328"
        foreground="#ffffff"
        liquidGlassAvailable={false}
        topInset={insets.top}
        onBack={() => router.back()}
        accessibilityHidden={false}
        frostTarget={colorOS ? frost : undefined}
      />
      <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 100, left: 12 }}>
        <Text style={{ color: "#fff", fontSize: 12 }}>{`E2E LIST OPEN colorOS=${colorOS ? "ON" : "OFF"} E2ELIST sent=${stats.sent} replied=${stats.replied}`}</Text>
        <Text style={{ color: "#fff", fontSize: 12 }}>{kb}</Text>
      </View>
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]} onLayout={motion.onComposerLayout}>
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
          onSend={send}
          keyboardProgress={motion.keyboardProgress}
          keyboardHeight={motion.keyboardHeight}
          frostTarget={colorOS ? frost : undefined}
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
