// CI injection only. Fail if a baseline anchor changes.
import { cpSync, readFileSync, writeFileSync } from "node:fs";

function patch(path, replacements, imports = "") {
  let source = readFileSync(path, "utf8");
  for (const [anchor, replacement] of replacements) {
    if (!source.includes(anchor)) throw new Error(`layout harness anchor missing in ${path}: ${anchor.slice(0, 90)}`);
    source = source.replace(anchor, replacement);
  }
  writeFileSync(path, imports + source);
}
const chat = "apps/mobile/src/features/chat/components/";
cpSync(".github/e2e/layout-events.ts", "apps/mobile/src/e2e/layout-events.ts");
cpSync(".github/e2e/harness-b113/lib/layout-fixture.ts", "apps/mobile/src/e2e/layout-fixture.ts");
cpSync(".github/e2e/harness-b113/app/e2e-layout.tsx", "apps/mobile/src/app/e2e-layout.tsx");
patch("apps/mobile/src/app/_layout.tsx", [
  [
    '<Stack.Screen name="e2e-picker"',
    '<Stack.Screen name="e2e-layout" options={{ headerShown: false }} />\n                    <Stack.Screen name="e2e-picker"',
  ],
]);
patch("apps/mobile/src/app/index.tsx", [
  [
    '<Text style={{ color: "#fff" }}>Toggle ColorOS</Text>\n        </Pressable>',
    '<Text style={{ color: "#fff" }}>Toggle ColorOS</Text>\n        </Pressable>\n        <Pressable accessibilityRole="button" accessibilityLabel="E2E Layout" onPress={() => router.push("/e2e-layout")} style={{ padding: 12 }}><Text style={{ color: "white" }}>E2E Layout</Text></Pressable>',
  ],
]);
patch(
  "apps/mobile/src/e2e/real-workspace.tsx",
  [
    [
      "agents: [REAL_AGENT, LONG_AGENT, SHORT_AGENT]",
      'agents: [REAL_AGENT, LONG_AGENT, SHORT_AGENT, { ...REAL_AGENT, id: STRESS_AGENT_ID, name: "LAYOUT" }]',
    ],
    [
      'get: (agentId?: string) => (agentId === "e2e-long"',
      'get: (agentId?: string) => (agentId === STRESS_AGENT_ID ? stressStore.get() : agentId === "e2e-long"',
    ],
    [
      "if (!notify) return () => undefined;",
      "if (!notify) return () => undefined;\n    if (agentId === STRESS_AGENT_ID) return stressStore.subscribe(notify);",
    ],
    [
      'isUpToDate: (agentId?: string) => (agentId === "e2e-long"',
      'isUpToDate: (agentId?: string) => (agentId === STRESS_AGENT_ID ? stressStore.isUpToDate() : agentId === "e2e-long"',
    ],
    [
      'const load = (agentId?: string) => (agentId === "e2e-long"',
      'const load = (agentId?: string) => (agentId === STRESS_AGENT_ID ? loadStress() : agentId === "e2e-long"',
    ],
    [
      "activityByServer: {},",
      'activityByServer: { "e2e-server": { [STRESS_AGENT_ID]: { phase: "waiting", reason: "question", turnId: "e2e-layout-wait" } } },',
    ],
    ["const loadLong = () =>", "const loadLong = (emit = captureLayoutEvents()) =>"],
    ["const loadShort = () =>", "const loadShort = (emit = captureLayoutEvents()) =>"],
    ["longNow = longLatest;", 'emit("catch-up-complete", { agent: "long" });\n      longNow = longLatest;'],
    ["shortNow = shortLatest;", 'emit("catch-up-complete", { agent: "short" });\n      shortNow = shortLatest;'],
  ],
  'import { STRESS_AGENT_ID, stressStore, loadStress } from "@/e2e/layout-fixture";\nimport { captureLayoutEvents } from "@/e2e/layout-events";\n',
);
patch(
  `${chat}use-chat-motion.ts`,
  [
    [
      "  const listRef = useRef<LegendListRef>(null);",
      "  const __layoutEvent = useScopedLayoutEvent();\n  const listRef = useRef<LegendListRef>(null);",
    ],
    [
      "  const finishFirstMessage =",
      "  useLayoutEvents(listRef, { uiOffset: scrollOffset, uiContent: content, uiViewport: viewport, composer: composerHeight, keyboard: keyboardHeight, keyboardProgress, revealed, scrolledUp });\n  const finishFirstMessage =",
    ],
    ["    revealed.set(true);", '    __layoutEvent("reveal");\n    revealed.set(true);'],
    [
      "setPlacedWithRows(withRows); }, []);",
      'setPlacedWithRows(withRows); __layoutEvent("list-ready", { withRows }); }, []);',
    ],
    [
      "      measurements.current.viewport =",
      '      __layoutEvent("viewport", { height: event.nativeEvent.layout.height });\n      measurements.current.viewport =',
    ],
    [
      "      measurements.current.content = height;",
      '      __layoutEvent("content", { height });\n      measurements.current.content = height;',
    ],
    [
      "      measurements.current.composer = height;",
      '      __layoutEvent("composer", { height });\n      measurements.current.composer = height;',
    ],
    ...["onStart", "onMove", "onInteractive", "onEnd"].map((name) => [
      `      ${name}: (event) => {\n        "worklet";`,
      `      ${name}: (event) => {\n        "worklet";\n        scheduleOnRN(__layoutEvent, "keyboard", { phase: "${name}", height: event.height, progress: event.progress, duration: event.duration });`,
    ]),
  ],
  'import { useScopedLayoutEvent, useLayoutEvents } from "@/e2e/layout-events";\n',
);
patch(
  `${chat}chat-view.tsx`,
  [
    [
      "  const atLatest = motion.atLatest;",
      '  const atLatest = motion.atLatest;\n  const __layoutEvent = useScopedLayoutEvent();\n  useEffect(() => { __layoutEvent("view", { ready, catchingUp, historyVisible: motion.historyVisible, atLatest, count: messages.length }); }, [ready, catchingUp, motion.historyVisible, atLatest, messages.length]);',
    ],
  ],
  'import { useScopedLayoutEvent } from "@/e2e/layout-events";\n',
);
patch(
  `${chat}chat-message-list.tsx`,
  [
    [
      "  const tailIndex = rows.findLastIndex",
      '  const __layoutEvent = useScopedLayoutEvent();\n  useEffect(() => { __layoutEvent("row-window", { allRows, count: rows.length }); }, [allRows, rows]);\n  const tailIndex = rows.findLastIndex',
    ],
    [
      "              onReady={onReady}",
      '              onReady={onReady}\n              onEndVisible={(visible) => __layoutEvent("native-end", { visible })}',
    ],
  ],
  'import { useScopedLayoutEvent } from "@/e2e/layout-events";\n',
);
patch(
  "apps/mobile/src/shared/motion/LiveZoomScreen.tsx",
  [
    [
      "  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();",
      "  const __layoutEvent = useScopedLayoutEvent();\n  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();",
    ],
    ["      st.settled = true;", '      st.settled = true;\n      __layoutEvent("zoom-settled");'],
  ],
  'import { useScopedLayoutEvent } from "@/e2e/layout-events";\n',
);
console.log("layout harness applied");
