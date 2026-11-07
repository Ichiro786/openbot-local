// E2E only (build 11.3): a stand-in workspace for the REAL agent chat screen (AgentChatScreen ->
// MobileChatView -> ChatView: useLeaveChat, useZoomClose, the ColorOS header with the thread menu,
// the edge-swipe gesture, KeyboardGestureArea, list, composer, frost). Signed out, no host: one agent,
// an empty loaded conversation, tasks on (so the name pill opens the thread menu). Unknown fields are
// a callable "anything" that returns itself.
import type { PropsWithChildren } from "react";
import { OutboxProvider } from "@/features/chat/context/outbox-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
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
export const REAL_AGENT = {
  id: "e2e-agent",
  serverId: "e2e-server",
  name: "VEYR",
  title: "Review helper",
  description: "",
  preview: "",
  updatedLabel: "",
  avatarSeed: "e2e-seed",
  avatarHue: null, // 41809028530: a number is no AvatarHue id (avatarHeadColor -> undefined -> voicePalette .trim crash)
  avatarColor: null,
  avatarUrl: null,
  pinned: false,
};
export const LONG_AGENT = { ...REAL_AGENT, id: "e2e-long", name: "LORE", avatarSeed: "e2e-long-seed" };
const REAL_MESSAGES = Array.from({ length: 28 }, (_, i) => {
  const user = i % 2 === 0;
  const text = user
    ? `Question ${i / 2 + 1}: can you check the build log and tell me what failed?`
    : [
        `## Result ${i}`,
        "The build **failed** at the Gradle configure step. Here is what I found:",
        "- the NDK download was corrupt",
        "- the rootfs was staged correctly",
        "- nothing in the app code changed",
        "```kotlin",
        "fun main() {",
        '    println("retry the job")',
        "}",
        "```",
        "Re-running the job should fix it. I can do that for you if you want, or wait for the next push.",
        ...(i === 27 ? ["LATEST-END-VEYR"] : []),
      ].join("\n");
  return {
    id: `e2e-msg-${i}`,
    turnId: `e2e-turn-${Math.floor(i / 2)}`,
    author: user ? "user" : "assistant",
    text,
    createdAt: new Date(Date.UTC(2026, 10, 5, 10, i)).toISOString(),
    status: "completed",
  };
});
// Build #101 open-at-latest: a long history (like Syed's agents: long list replies between short
// exchanges). The phone keeps an older page; the latest page (6 more rows) loads after the chat opens.
const LONG_COUNT = 140;
const LONG_MESSAGES = Array.from({ length: LONG_COUNT }, (_, i) => {
  const user = i % 2 === 0;
  const long = !user && i % 6 === 1;
  const text = user
    ? i % 4 === 0
      ? `Great thanks (${i})`
      : `Message ${i}: please set up the team and review the stack for the Android app.`
    : long
      ? [
          `**Team Setup ${i}**`,
          ...Array.from({ length: 9 }, (_, k) => `- **Role ${k + 1}:** grounded in the official Compose standards, high-performance layout rendering and on-device checks for build ${i}.`),
          "Everything is synced with the full mobile reference set.",
        ].join("\n")
      : i === LONG_COUNT - 1
        ? "Anytime. Glad that's sorted out. LATEST-END-LONG"
        : `Anytime. We're fully equipped whenever you want to build or review something new (${i}).`;
  return {
    id: `e2e-long-${i}`,
    turnId: `e2e-long-turn-${Math.floor(i / 2)}`,
    author: user ? "user" : "assistant",
    text,
    createdAt: new Date(Date.UTC(2026, 10, 4, 8, i)).toISOString(),
    status: "completed",
  };
});
const base = {
  threadId: null,
  activeTurnId: null,
  revision: 1,
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
  olderLoading: false,
  olderError: false,
  detached: false,
};
const conversation = {
  ...base,
  agentId: "e2e-agent",
  // Build 11.3 open timing: a history like a real chat (markdown, lists, code), so the open measures ChatView's real cost.
  messages: REAL_MESSAGES,
};
const longKept = { ...base, agentId: "e2e-long", messages: LONG_MESSAGES.slice(0, LONG_COUNT - 6) };
const longLatest = { ...base, agentId: "e2e-long", revision: 2, messages: LONG_MESSAGES };
let longNow = longKept;
let longUpToDate = false;
const longListeners = new Set<() => void>();
// The home row resets the long chat before each open, so every open catches up again.
(globalThis as any).__e2eLongReset = () => {
  longNow = longKept;
  longUpToDate = false;
};
const conversationStore = {
  get: (agentId?: string) => (agentId === "e2e-long" ? longNow : conversation),
  subscribe: (agentId?: string, notify?: () => void) => {
    if (agentId !== "e2e-long" || !notify) return () => undefined;
    longListeners.add(notify);
    return () => longListeners.delete(notify);
  },
  isUpToDate: (agentId?: string) => (agentId === "e2e-long" ? longUpToDate : true),
  cachedPage: () => undefined,
};
const loadLong = () =>
  new Promise<typeof longLatest>((resolve) =>
    setTimeout(() => {
      longNow = longLatest;
      longUpToDate = true;
      for (const notify of longListeners) notify();
      resolve(longLatest);
    }, 700),
  );
const server = { id: "e2e-server", name: "E2E", status: "online", online: true, connected: true, initialConnectionPending: false };
// Every live map the chat reads (use-live-workspace, use-live-activity), empty and stable.
const liveSnapshot = {
  activityByServer: {},
  approvalRequests: {},
  browserRequests: {},
  browserTabs: {},
  turnLinesByServer: {},
  unreadAgentIds: [],
  unreadCounts: {},
};
const live = { get: () => liveSnapshot, subscribe: () => () => undefined };
const known: Record<string, unknown> = {
  agents: [REAL_AGENT, LONG_AGENT],
  servers: [server],
  activeServer: server,
  liveState: live,
  conversationStore,
  loadConversation: async (agentId?: string) => (agentId === "e2e-long" ? loadLong() : conversation),
  loadConversationAround: async () => true,
  loadLatestMessages: async (agentId?: string) => (agentId === "e2e-long" ? loadLong() : conversation),
  loadOlderMessages: async () => undefined,
  markAgentRead: () => undefined,
  canUseTasks: () => true,
  browserViewSupport: () => ({ view: true, control: true }),
};
const value: any = new Proxy({}, { get: (_t, key) => (typeof key === "string" && key in known ? known[key] : anything) });
const channelState = { channels: [], loaded: true };
const knownActions: Record<string, unknown> = {
  channelStore: { subscribe: () => () => undefined, get: () => channelState, observe: () => undefined },
};
const actions: any = new Proxy({}, { get: (_t, key) => (typeof key === "string" && key in knownActions ? knownActions[key] : anything) });

export function RealWorkspace({ children }: PropsWithChildren) {
  return (
    <WorkspaceContexts value={value} actions={actions}>
      {/* The chat reads these two from the signed-in layout ((app)/_layout.tsx); 41804841271: "QueuedMessagesProvider is missing." */}
      <OutboxProvider>
        <QueuedMessagesProvider>{children}</QueuedMessagesProvider>
      </OutboxProvider>
    </WorkspaceContexts>
  );
}
