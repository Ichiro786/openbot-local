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
  avatarHue: 270,
  avatarColor: null,
  avatarUrl: null,
  pinned: false,
};
const conversation = {
  agentId: REAL_AGENT.id,
  threadId: null,
  activeTurnId: null,
  revision: 1,
  messages: [],
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
  olderLoading: false,
  olderError: false,
  detached: false,
};
const conversationStore = {
  get: () => conversation,
  subscribe: () => () => undefined,
  isUpToDate: () => true,
  cachedPage: () => undefined,
};
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
  agents: [REAL_AGENT],
  servers: [server],
  activeServer: server,
  liveState: live,
  conversationStore,
  loadConversation: async () => conversation,
  loadConversationAround: async () => true,
  loadLatestMessages: async () => conversation,
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
