// E2E only (build 11.3): a stand-in workspace for the REAL agent chat screen (AgentChatScreen ->
// MobileChatView -> ChatView: useLeaveChat, useZoomClose, the ColorOS header with the thread menu,
// the edge-swipe gesture, KeyboardGestureArea, list, composer, frost). Signed out, no host: one agent,
// an empty loaded conversation, tasks on (so the name pill opens the thread menu). Unknown fields are
// a callable "anything" that returns itself.
import type { PropsWithChildren } from "react";
import { OutboxProvider } from "@/features/chat/context/outbox-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
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
// Build #102: a short history that also catches up on open (Syed: every agent opened at older messages).
export const SHORT_AGENT = { ...REAL_AGENT, id: "e2e-short", name: "SHORTY", avatarSeed: "e2e-short-seed" };
// Build 15: a reply with `openbot-ui` blocks (generative UI v1), for a screenshot of the native rendering.
export const UI_AGENT = { ...REAL_AGENT, id: "e2e-ui", name: "UIBOT", avatarSeed: "e2e-ui-seed" };
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
  // Build #102: the last row must carry the marker (139 % 6 === 1 made it a Team Setup reply, so
  // LATEST-END-LONG never existed and every #101/#102 LORE check read MISSING).
  const long = !user && i % 6 === 1 && i !== LONG_COUNT - 1;
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
const SHORT_MESSAGES = [
  "Hi, can you set up the team?",
  ["## Team Setup", ...Array.from({ length: 6 }, (_, k) => `- **Role ${k + 1}:** grounded in the official standards, layout rendering and on-device checks.`)].join("\n"),
  "Great thanks.",
  "Anytime. Glad that's sorted out. LATEST-END-SHORT",
].map((text, i) => ({
  id: `e2e-short-${i}`,
  turnId: `e2e-short-turn-${Math.floor(i / 2)}`,
  author: i % 2 === 0 ? "user" : "assistant",
  text,
  createdAt: new Date(Date.UTC(2026, 10, 9, 10, i)).toISOString(),
  status: "completed",
}));
const UI_REPLY = [
  "Here is how the three plans compare:",
  "```openbot-ui",
  '{"type":"stats","items":[{"label":"Cheapest","value":"Basic","delta":"₹199/mo","tone":"positive"},{"label":"Most storage","value":"Pro","delta":"2 TB"}]}',
  '{"type":"chart","kind":"bar","title":"Price per month (₹)","labels":["Basic","Plus","Pro"],"series":[{"name":"Price","values":[199,449,899]}]}',
  '{"type":"actions","style":"chips","items":[{"id":"plan","label":"Basic","value":"basic"},{"id":"plan","label":"Plus","value":"plus"},{"id":"plan","label":"Pro","value":"pro","style":"primary"}]}',
  "```",
  "Pick one and I'll set it up. GENUI-END",
].join("\n");
const uiConversation = {
  ...base,
  agentId: "e2e-ui",
  messages: [
    { id: "e2e-ui-0", turnId: "e2e-ui-turn-0", author: "user", text: "Compare the plans for me", createdAt: new Date(Date.UTC(2026, 10, 10, 10, 0)).toISOString(), status: "completed" },
    { id: "e2e-ui-1", turnId: "e2e-ui-turn-0", author: "assistant", text: UI_REPLY, createdAt: new Date(Date.UTC(2026, 10, 10, 10, 1)).toISOString(), status: "completed" },
  ],
};

// Build 15.3: long replies with openbot-ui blocks, the shape of Syed's blank chat (2026-11-16): a bold
// summary, a bar chart block, text, a table block, a rule, a heading and a long tail; then variants
// (more blocks after the heading, a code block + Markdown table + a very tall tail, broken blocks).
// Markers (V1-M10 ... V4-END) let the smoke check that every part draws as it scrolls past.
export const GEN_AGENT = { ...REAL_AGENT, id: "e2e-gen", name: "GENBOT", avatarSeed: "e2e-gen-seed" };
export const GENS_AGENT = { ...REAL_AGENT, id: "e2e-gens", name: "GENSTREAM", avatarSeed: "e2e-gens-seed" };
const j = (value: unknown) => JSON.stringify(value);
const filler = "long comparison text about agentic coding, tool use, latency and price per token ";
const bullets = (tag: string, count: number) =>
  Array.from({ length: count }, (_, i) => `- **Feature ${i + 1}:** ${filler.repeat(2)}${(i + 1) % 10 === 0 ? ` ${tag}-M${i + 1}` : ""}`).join("\n");
const V1 = [
  "**Gemini 4 Hydrogen leads on reasoning depth and autonomous software engineering, while Qwen 3.8 Flash delivers near-frontier performance at roughly one-tenth the cost with open-weight flexibility.**",
  "",
  "Here is the benchmark comparison across software engineering, coding synthesis, and scientific reasoning:",
  "",
  "```openbot-ui",
  j({ type: "chart", kind: "bar", labels: ["SWE-bench Verified", "LiveCodeBench", "GPQA Diamond"], series: [{ name: "Qwen 3.8 Flash", values: [61.2, 70.4, 71.8] }, { name: "Gemini Hydrogen", values: [68.9, 74.1, 79.3] }] }),
  "```",
  "",
  "Below are the architectural, operational, and pricing specifications for both models:",
  "",
  "```openbot-ui",
  j({ type: "table", columns: ["Specification", "Qwen 3.8 Flash", "Gemini Hydrogen"], rows: [["Developer", "Alibaba (Qwen Team)", "Google DeepMind"], ["Pricing (Input / 1M)", "$0.15", "$1.25"], ["Pricing (Output / 1M)", "$0.47", "$5.00"], ["Context Window", "1M tokens", "1M tokens"], ["Architecture", "Open-weight MoE (120B total / 6B active)", "Proprietary"], ["Supported Modalities", "Text, Image", "Text, Image, Audio, Video"]] }),
  "```",
  "",
  "---",
  "",
  "## Feature Breakdown",
  "",
  bullets("V1", 40),
  "",
  "Unchecked: account-specific promotional pricing. V1-END",
].join("\n");
const V2 = [
  "Here is the cost view.",
  "",
  "## Cost Breakdown",
  "",
  "```openbot-ui",
  j({ type: "stats", items: [{ label: "Cheapest", value: "Qwen", delta: "$0.15 / 1M", tone: "positive" }, { label: "Best reasoning", value: "Gemini", delta: "GPQA 79.3" }] }),
  j({ type: "chart", kind: "line", title: "Price per 1M output tokens", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Qwen", values: [0.6, 0.55, 0.5, 0.47, 0.47, 0.47] }, { name: "Gemini", values: [6, 5.5, 5, 5, 5, 5] }] }),
  j({ type: "chart", kind: "donut", title: "Monthly spend split", labels: ["Qwen", "Gemini"], series: [{ name: "Spend", values: [30, 70] }] }),
  "```",
  "",
  "And the full matrix:",
  "",
  "```openbot-ui",
  j({ type: "table", columns: ["Model", "Input", "Output", "Context", "Open", "Vision"], rows: [["Qwen 3.8 Flash", "$0.15", "$0.47", "1M", "yes", "yes"], ["Gemini Hydrogen", "$1.25", "$5.00", "1M", "no", "yes"]] }),
  j({ type: "callout", tone: "warning", title: "Check before you switch", body: "Prices change often; confirm on the provider page." }),
  j({ type: "steps", items: [{ label: "Pick a model", status: "done" }, { label: "Run the eval", status: "active" }, { label: "Ship", status: "pending" }] }),
  "```",
  "",
  bullets("V2", 12),
  "",
  "V2-END",
].join("\n");
const V3 = [
  "Here is a script and the raw numbers.",
  "",
  "```python",
  ...Array.from({ length: 30 }, (_, i) => `print("row ${i}", ${i} * 2)  # compare the models line ${i}`),
  "```",
  "",
  "| Model | Input | Output | Context | Notes |",
  "| --- | --- | --- | --- | --- |",
  ...Array.from({ length: 15 }, (_, i) => `| Model ${i} | $0.${i}5 | $${i}.47 | ${i + 1}M | open weights, fast, cheap ${i} |`),
  "",
  "## Very tall tail",
  "",
  bullets("V3", 60),
  "",
  "V3-END",
].join("\n");
const V4 = [
  "Some blocks below are broken on purpose.",
  "",
  "```openbot-ui",
  '{"type":"chart","kind":"bar","labels":["a","b"],"series":[{"name":"x","values":[1,2]}',
  "```",
  "",
  "```openbot-ui",
  j({ type: "carousel", items: [1, 2, 3] }),
  "```",
  "",
  "```openbot-ui",
  j({ type: "card", title: "Nested card", body: "**Markdown** body with a [link](https://example.com).", children: [{ type: "list", items: [{ icon: "check", title: "One", trailing: "1" }, { icon: "star", title: "Two", subtitle: "second item" }] }, { type: "progress", value: 0.4, label: "Upload" }] }),
  j({ type: "actions", style: "chips", items: [{ id: "pick", label: "Qwen", value: "qwen" }, { id: "pick", label: "Gemini", value: "gemini", style: "primary" }] }),
  j({ type: "form", id: "budget", title: "Budget", fields: [{ name: "limit", label: "Monthly limit", kind: "number", required: true }, { name: "alerts", label: "Alerts", kind: "toggle" }] }),
  "```",
  "",
  bullets("V4", 10),
  "",
  "V4-END",
].join("\n");
const genAt = (i: number) => new Date(Date.UTC(2026, 10, 12, 10, i)).toISOString();
const genConversation = {
  ...base,
  agentId: "e2e-gen",
  messages: [
    "Can u compare qwen 3.8 flash with gemini hydrogen using charts",
    V1,
    "Show the costs",
    V2,
    "Give me the raw numbers",
    V3,
    "Try some broken blocks",
    V4,
  ].map((text, i) => ({ id: `e2e-gen-${i}`, turnId: `e2e-gen-turn-${Math.floor(i / 2)}`, author: i % 2 === 0 ? "user" : "assistant", text, createdAt: genAt(i), status: "completed" })),
};
// A reply that streams on open (60 characters every 150 ms), then completes; a reopen shows it finished.
const GENS_FULL = V1.replace(/V1-/g, "S1-");
let gensNow = { ...base, agentId: "e2e-gens", messages: [] as typeof genConversation.messages };
let gensTimer: ReturnType<typeof setInterval> | null = null;
let gensDone = false;
const gensListeners = new Set<() => void>();
const gensSet = (text: string, status: string) => {
  gensNow = {
    ...gensNow,
    revision: gensNow.revision + 1,
    messages: [
      { id: "e2e-gens-0", turnId: "e2e-gens-turn-0", author: "user", text: "Can u compare qwen 3.8 flash with gemini hydrogen using charts", createdAt: genAt(20), status: "completed" },
      { id: "e2e-gens-1", turnId: "e2e-gens-turn-0", author: "assistant", text, createdAt: genAt(21), status },
    ],
  };
  for (const notify of gensListeners) notify();
};
gensSet("", "completed");
gensNow = { ...gensNow, messages: gensNow.messages.slice(0, 1) };
const gensStart = () => {
  if (gensTimer || gensDone) return;
  let end = 0;
  console.log("E2EGENS start");
  gensTimer = setInterval(() => {
    end = Math.min(GENS_FULL.length, end + 60);
    const done = end >= GENS_FULL.length;
    gensSet(GENS_FULL.slice(0, end), done ? "completed" : "streaming");
    if (done && gensTimer) {
      clearInterval(gensTimer);
      gensTimer = null;
      gensDone = true;
      console.log("E2EGENS done");
    }
  }, 150);
};
const shortKept = { ...base, agentId: "e2e-short", messages: SHORT_MESSAGES.slice(0, 2) };
const shortLatest = { ...base, agentId: "e2e-short", revision: 2, messages: SHORT_MESSAGES };
let shortNow = shortKept;
let shortUpToDate = false;
const shortListeners = new Set<() => void>();
let longNow = longKept;
let longUpToDate = false;
const longListeners = new Set<() => void>();
// The home row resets the long chat before each open, so every open catches up again.
(globalThis as any).__e2eLongReset = () => {
  longNow = longKept;
  longUpToDate = false;
  shortNow = shortKept;
  shortUpToDate = false;
};
const conversationStore = {
  get: (agentId?: string) =>
    agentId === "e2e-long" ? longNow : agentId === "e2e-short" ? shortNow : agentId === "e2e-ui" ? uiConversation : agentId === "e2e-gen" ? genConversation : agentId === "e2e-gens" ? gensNow : conversation,
  // Build #102 (invalid #101 test: the stand-in server had no state "online", so the chat never ran its
  // own catch-up): the server is online now, and the chat itself reads the latest page (loadConversation,
  // 700 ms) while it shows the kept one (catchingUp), as on the phone.
  subscribe: (agentId?: string, notify?: () => void) => {
    if (!notify) return () => undefined;
    if (agentId === "e2e-gens") gensStart();
    const set = agentId === "e2e-long" ? longListeners : agentId === "e2e-short" ? shortListeners : agentId === "e2e-gens" ? gensListeners : null;
    if (!set) return () => undefined;
    set.add(notify);
    return () => set.delete(notify);
  },
  isUpToDate: (agentId?: string) => (agentId === "e2e-long" ? longUpToDate : agentId === "e2e-short" ? shortUpToDate : true),
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
const loadShort = () =>
  new Promise<typeof shortLatest>((resolve) =>
    setTimeout(() => {
      shortNow = shortLatest;
      shortUpToDate = true;
      for (const notify of shortListeners) notify();
      resolve(shortLatest);
    }, 700),
  );
const load = (agentId?: string) =>
  agentId === "e2e-long" ? loadLong() : agentId === "e2e-short" ? loadShort() : Promise.resolve(agentId === "e2e-ui" ? uiConversation : agentId === "e2e-gen" ? genConversation : agentId === "e2e-gens" ? gensNow : conversation);
const server = { id: "e2e-server", name: "E2E", state: "online", status: "online", online: true, connected: true, initialConnectionPending: false };
// Every live map the chat reads: the app's own empty store, so maps upstream adds (1.4.9: firstUnreadMessageIds, threadWaitsByServer) exist.
const live = new LiveWorkspaceStore();
const known: Record<string, unknown> = {
  agents: [REAL_AGENT, LONG_AGENT, SHORT_AGENT, UI_AGENT, GEN_AGENT, GENS_AGENT],
  servers: [server],
  activeServer: server,
  liveState: live,
  conversationStore,
  loadConversation: async (agentId?: string) => load(agentId),
  loadConversationAround: async () => true,
  loadLatestMessages: async (agentId?: string) => load(agentId),
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
