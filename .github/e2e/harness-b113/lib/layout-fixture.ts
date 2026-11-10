// Synthetic data only. The existing LORE marker failure stays unchanged.
import { File, Paths } from "expo-file-system";
import { captureLayoutEvents } from "@/e2e/layout-events";
import { requestComposerText } from "@/features/chat/model/composer-requests";

export const STRESS_AGENT_ID = "e2e-layout-stress";
const messages = Array.from({ length: 144 }, (_, index) => ({
  id: `e2e-layout-${index}`,
  turnId: `e2e-layout-turn-${Math.floor(index / 2)}`,
  author: index % 2 ? "assistant" : "user",
  status: "completed",
  createdAt: new Date(Date.UTC(2026, 10, 9, 10, index)).toISOString(),
  text:
    index % 2
      ? [
          `## Synthetic result ${index}`,
          ...Array.from(
            { length: index > 135 ? 24 : 8 },
            (_, n) => `- **Check ${n}:** synthetic Markdown for repeatable row measurement.`,
          ),
          "```ts",
          "const result = true;",
          "```",
        ].join("\n")
      : `Synthetic request ${index}`,
}));
const question = {
  id: "e2e-layout-question",
  turnId: "e2e-layout-wait",
  author: "assistant",
  status: "completed",
  createdAt: new Date(Date.UTC(2026, 10, 10)).toISOString(),
  text: "",
  questionPrompt: {
    requestId: "e2e-layout-request",
    resolution: null,
    questions: [
      {
        id: "e2e-layout-choice",
        header: "Synthetic choice",
        question: "Which synthetic case should continue?",
        isSecret: false,
        options: [{ label: "Continue", description: "Continue this synthetic case." }],
      },
    ],
  },
};
const base = {
  agentId: STRESS_AGENT_ID,
  threadId: null,
  activeTurnId: "e2e-layout-wait",
  revision: 1,
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
  olderLoading: false,
  olderError: false,
  detached: false,
};
let mode = "overlap";
function fixtureMessages(start: number, end?: number) {
  return messages
    .slice(start, end)
    .map((message) =>
      mode === "tall" && message.author === "assistant" && Number(message.id.split("-").at(-1)) >= 135
        ? { ...message, text: "Synthetic short reply before the pending question." }
        : message,
    );
}
let generation = 0;
let upToDate = false;
let current: typeof base & { messages: ((typeof messages)[number] | typeof question)[] } = {
  ...base,
  messages: messages.slice(0, 138),
};
const listeners = new Set<() => void>();
export const stressStore = {
  get: () => current,
  isUpToDate: () => upToDate,
  subscribe: (notify: () => void) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  },
};
export function prepareLayoutFixture(nextMode: string, fresh: boolean, tall: boolean) {
  mode = nextMode;
  if (fresh) {
    generation += 1;
    upToDate = false;
    current = { ...base, messages: fixtureMessages(0, mode === "disconnected" ? 80 : 138) };
  }
  if (tall) {
    const file = new File(Paths.cache, `e2e-layout-${generation}.txt`);
    file.writeSync("Synthetic attachment. No user data.\n");
    requestComposerText({
      serverId: "e2e-server",
      agentId: STRESS_AGENT_ID,
      text: Array.from({ length: 7 }, (_, n) => `Synthetic draft line ${n + 1}`).join("\n"),
      files: [{ uri: file.uri, name: "e2e-layout.txt" }],
    });
  }
}
export async function loadStress() {
  const layoutEvent = captureLayoutEvents();
  if (upToDate) {
    layoutEvent("catch-up-cached");
    return current;
  }
  const started = generation;
  layoutEvent("catch-up-start", { mode, generation });
  // Delays create host delivery order. They are not layout completion conditions.
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (started !== generation) return current;
  current = {
    ...base,
    revision: 2,
    messages: fixtureMessages(mode === "disconnected" ? 118 : 0, 142),
  };
  for (const notify of listeners) notify();
  layoutEvent("catch-up-page", { count: current.messages.length, generation });
  await new Promise((resolve) => setTimeout(resolve, 520));
  if (started !== generation) return current;
  current = {
    ...base,
    revision: 3,
    messages: [...fixtureMessages(mode === "disconnected" ? 118 : 0), question],
  };
  upToDate = true;
  for (const notify of listeners) notify();
  layoutEvent("catch-up-complete", { count: current.messages.length, generation });
  return current;
}
