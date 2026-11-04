// Applies the E2E harness onto the checked-out target ref (CI only).
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

cpSync(".github/e2e/harness/app", "apps/mobile/src/app", { recursive: true });
// Build 9+: register a frost target like home does, so the glass menu takes its BlurView path.
if (existsSync("apps/mobile/src/shared/motion/frostTarget.ts")) {
  cpSync(".github/e2e/harness-frost/app", "apps/mobile/src/app", { recursive: true });
  console.log("frost harness variant applied");
}
const path = "apps/mobile/src/app/_layout.tsx";
let src = readFileSync(path, "utf8");
const anchor = '<Stack.Protected guard={!session} redirectTo="/connected">';
if (!src.includes(anchor)) throw new Error("root layout anchor not found");
src = src.replace(
  anchor,
  `${anchor}
                    <Stack.Screen
                      name="e2e-sheet"
                      options={{
                        headerShown: false,
                        presentation: "formSheet",
                        sheetAllowedDetents: [0.85],
                        sheetGrabberVisible: true,
                      }}
                    />`,
);
// Build 10+: the zoom-open chat stand-in, with the stack options the real chat routes use (zoomPush).
if (existsSync("apps/mobile/src/shared/motion/zoomPush.ts")) {
  cpSync(".github/e2e/harness-b10/app", "apps/mobile/src/app", { recursive: true });
  cpSync(".github/e2e/harness-b10/lib", "apps/mobile/src/e2e", { recursive: true });
  // Item 6 (agent page) exists from 92bb12d2 on; older targets drop the agent page route.
  if (!existsSync("apps/mobile/src/features/agents/components/agent-page-hub.tsx")) {
    rmSync("apps/mobile/src/app/e2e-agent.tsx");
    const chat = "apps/mobile/src/app/e2e-chat.tsx";
    writeFileSync(chat, readFileSync(chat, "utf8").replace('import { AgentPageHero } from "@/features/agents/components/agent-page-hub";\nvoid AgentPageHero;', ""));
  }
  src = `import { isZoomPush as __e2eIsZoomPush, releaseZoomPush as __e2eReleaseZoomPush, zoomPushAnimation as __e2eZoomPushAnimation } from "@/shared/motion/zoomPush";\n${src}`;
  src = src.replace(
    anchor,
    `${anchor}
                    <Stack.Screen name="e2e-agent" options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen
                      name="e2e-chat"
                      options={({ route }) => ({ animation: __e2eZoomPushAnimation(route.key, "slide_from_right"), headerShown: false })}
                      listeners={({ navigation, route }) => {
                        const release = () => {
                          if (__e2eReleaseZoomPush(route.key)) navigation.setOptions({});
                        };
                        return {
                          transitionEnd: (event) => {
                            if (!event.data?.closing) release();
                          },
                          focus: () => {
                            if (__e2eIsZoomPush(route.key)) setTimeout(release, 2000);
                          },
                        };
                      }}
                    />`,
  );
  console.log("build 10 harness variant applied");
}

// Build 11+: the blur counter as on-screen text, and the upstream v0.60 plush avatars route.
{
  const index = "apps/mobile/src/app/index.tsx";
  const chat = "apps/mobile/src/app/e2e-chat.tsx";
  if (existsSync("apps/mobile/src/shared/glass/blurBudget.ts") && existsSync(index)) {
    cpSync(".github/e2e/harness-b11/lib/blur-max.tsx", "apps/mobile/src/e2e/blur-max.tsx");
    for (const [file, anchorText] of [
      [index, "{`LAST=${last}`}</Text>"],
      [chat, "{`SENT=${sent.replaceAll(\"\\n\", \"\\\\n\")}`}</Text>"],
    ]) {
      if (!existsSync(file)) continue;
      let f = readFileSync(file, "utf8");
      if (!f.includes(anchorText)) throw new Error(`blur-max anchor missing in ${file}`);
      f = `import { E2EBlurMax } from "@/e2e/blur-max";\n${f}`.replace(anchorText, `${anchorText}\n        <E2EBlurMax />`);
      writeFileSync(file, f);
    }
    console.log("blur counter text applied");
  }
  if (existsSync("apps/mobile/src/features/agents/components/use-plush-frame.ts") && existsSync(index)) {
    cpSync(".github/e2e/harness-b11/app/e2e-plush.tsx", "apps/mobile/src/app/e2e-plush.tsx");
    let f = readFileSync(index, "utf8");
    const toggle = "<Text style={{ color: \"#fff\" }}>Toggle ColorOS</Text>\n        </Pressable>";
    if (!f.includes(toggle)) throw new Error("plush anchor missing");
    f = f.replace(toggle, `${toggle}\n        <Pressable accessibilityRole="button" accessibilityLabel="E2E Plush" onPress={() => router.push("/e2e-plush")} style={{ marginHorizontal: 24, marginTop: 8, padding: 10, backgroundColor: "#3b5b7a", borderRadius: 12 }}><Text style={{ color: "#fff" }}>Plush</Text></Pressable>`);
    writeFileSync(index, f);
    src = src.replace(anchor, `${anchor}\n                    <Stack.Screen name="e2e-plush" options={{ headerShown: false }} />`);
    console.log("plush route applied");
  }
  // Build 11 item 3: the stand-in chat tells the zoom it has painted (as ChatView does), one frame after mount.
  if (existsSync(chat) && readFileSync("apps/mobile/src/shared/motion/zoomPush.ts", "utf8").includes("export function markZoomContentReady")) {
    let f = readFileSync(chat, "utf8");
    const marker = 'function E2EChat() {\n  "use no memo";';
    if (!f.includes(marker)) throw new Error("e2e-chat marker missing");
    f = `import { useRoute as __useRoute } from "expo-router/react-navigation";\nimport { useEffect as __useEffect } from "react";\nimport { markZoomContentReady as __markReady } from "@/shared/motion/zoomPush";\n${f}`.replace(
      marker,
      `${marker}\n  const __routeKey = __useRoute().key;\n  __useEffect(() => {\n    const frame = requestAnimationFrame(() => __markReady(__routeKey));\n    return () => cancelAnimationFrame(frame);\n  }, [__routeKey]);`,
    );
    writeFileSync(chat, f);
    console.log("zoom ready signal applied");
  }
  if (existsSync("apps/mobile/src/features/servers/screens/whatsapp-screen.tsx") && existsSync(index)) {
    cpSync(".github/e2e/harness-b11/app/e2e-whatsapp.tsx", "apps/mobile/src/app/e2e-whatsapp.tsx");
    let f = readFileSync(index, "utf8");
    const toggle = "<Text style={{ color: \"#fff\" }}>Toggle ColorOS</Text>\n        </Pressable>";
    f = f.replace(toggle, `${toggle}\n        <View style={{ flexDirection: "row", marginHorizontal: 24, marginTop: 8, gap: 8 }}><Pressable accessibilityRole="button" accessibilityLabel="E2E WhatsApp" onPress={() => router.push("/e2e-whatsapp?serverId=e2e-server&cap=1")} style={{ padding: 10, backgroundColor: "#25d366", borderRadius: 12 }}><Text style={{ color: "#000" }}>WA</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="E2E WhatsApp none" onPress={() => router.push("/e2e-whatsapp?serverId=e2e-server&cap=0")} style={{ padding: 10, backgroundColor: "#555", borderRadius: 12 }}><Text style={{ color: "#fff" }}>WA none</Text></Pressable></View>`);
    writeFileSync(index, f);
    src = src.replace(anchor, `${anchor}\n                    <Stack.Screen name="e2e-whatsapp" options={{ headerShown: false }} />`);
    console.log("whatsapp route applied");
  }
}

// Build 11 review: timing marks in the zoom overlay (tap = zoomOpen, opaque = surface fill done (p 0.55),
// skel = skeleton half in (p 0.675), push, uncover (ready or fallback), clear = dissolve done). Wall-clock ms
// relative to tap, shown on screen as "ZOOMT ..." by the blur-max text and logged as "E2EZOOM ...".
{
  const ov = "apps/mobile/src/shared/motion/ZoomOpenOverlay.tsx";
  if (existsSync(ov) && readFileSync(ov, "utf8").includes("DISSOLVE_MS")) {
    let f = readFileSync(ov, "utf8");
    const rep = (a, b) => {
      if (!f.includes(a)) throw new Error(`zoom timing anchor missing: ${a.slice(0, 60)}`);
      f = f.replace(a, b);
    };
    rep("let nextKey = 1;", `let nextKey = 1;
// E2E timing marks (review harness only).
const __e2eZ: Record<string, number | string> = {};
function __e2eMark(name: string, at: number) {
  if (__e2eZ[name] === undefined) __e2eZ[name] = at;
  if (name === "clear" && typeof __e2eZ.tap === "number") {
    const r = (k: string) => (typeof __e2eZ[k] === "number" ? (__e2eZ[k] as number) - (__e2eZ.tap as number) : -1);
    const text = \`ZOOMT tap=0 opaque=\${r("opaque")} skel=\${r("skel")} push=\${r("push")} uncover=\${r("uncover")} clear=\${r("clear")} via=\${__e2eZ.via ?? "?"}\`;
    (globalThis as { __e2eZoomLast?: string }).__e2eZoomLast = text;
    console.log(\`E2EZOOM \${text}\`);
  }
}`);
    rep("useZoomStore.setState({ request: { key: nextKey++, rect, radius, navigate } });", `for (const k of Object.keys(__e2eZ)) delete __e2eZ[k];
  __e2eZ.tap = Date.now();
  useZoomStore.setState({ request: { key: nextKey++, rect, radius, navigate } });`);
    rep("function clear() {", "function clear() {\n  if (__e2eZ.uncover !== undefined) __e2eMark(\"clear\", Date.now());");
    rep("    uncovered.current = true;", "    uncovered.current = true;\n    __e2eMark(\"uncover\", Date.now());\n    if (__e2eZ.via === undefined) __e2eZ.via = \"ready\";");
    rep("    done.current = true;", "    done.current = true;\n    __e2eMark(\"push\", Date.now());");
    rep("shownTimer.current = setTimeout(uncover, SHOWN_SAFETY_MS);", "shownTimer.current = setTimeout(() => {\n      if (!uncovered.current) __e2eZ.via = \"fallback\";\n      uncover();\n    }, SHOWN_SAFETY_MS);");
    rep("  const surfaceStyle = useAnimatedStyle(() => {", `  const __opq = useSharedValue(false);
  const __skel = useSharedValue(false);
  useAnimatedReaction(
    () => p.value,
    (value) => {
      if (!__opq.value && value >= zoom.fillFade[1]) {
        __opq.value = true;
        runOnJS(__e2eMark)("opaque", Date.now());
      }
      if (!__skel.value && value >= 0.675) {
        __skel.value = true;
        runOnJS(__e2eMark)("skel", Date.now());
      }
    },
  );
  const surfaceStyle = useAnimatedStyle(() => {`);
    f = f.replace("  __e2eZ.tap = Date.now();", "  __e2eZ.tap = Date.now();\n  (globalThis as { __e2eTap?: number }).__e2eTap = __e2eZ.tap as number;");
    writeFileSync(ov, f);
    const zp = "apps/mobile/src/shared/motion/zoomPush.ts";
    let z = readFileSync(zp, "utf8");
    const za = "export function markZoomContentReady(routeKey: string): void {";
    if (!z.includes(za)) throw new Error("markZoomContentReady anchor missing");
    z = z.replace(za, `${za}\n  {\n    const tap = (globalThis as { __e2eTap?: number }).__e2eTap ?? 0;\n    console.log(\`E2EREADY sinceTap=\${Date.now() - tap} match=\${routeKey === shownKey} armed=\${onShown !== null}\`);\n  }`);
    writeFileSync(zp, z);
    console.log("zoom timing marks applied");
  }
  // Item 7: the stand-in chat's composer gets real attachments (so the + shows) and a Use-skill action.
  const chat = "apps/mobile/src/app/e2e-chat.tsx";
  if (existsSync(chat) && readFileSync("apps/mobile/src/features/chat/components/chat-composer.tsx", "utf8").includes("onUseSkill?: () => void")) {
    let f = readFileSync(chat, "utf8");
    const a1 = 'const [draft, setDraft] = useState("");';
    const a2 = "onCancelReply={() => undefined}";
    if (!f.includes(a1) || !f.includes(a2)) throw new Error("plus-menu anchors missing in e2e-chat");
    f = `import { useChatAttachments as __useChatAttachments } from "@/features/chat/components/use-chat-attachments";\n${f}`
      .replace(a1, `${a1}\n  const __files = __useChatAttachments();`)
      .replace(a2, `${a2}\n          attachments={__files}\n          onUseSkill={() => setLog("USE SKILL")}`);
    // Hotfix 11.1: the composer reads the chat's keyboard height for the + menu anchor (as ChatView passes it).
    if (readFileSync("apps/mobile/src/features/chat/components/chat-composer.tsx", "utf8").includes("keyboardHeight?: SharedValue<number>")) {
      const kp = "keyboardProgress={motion.keyboardProgress}";
      if (!f.includes(kp)) throw new Error("keyboardProgress anchor missing in e2e-chat");
      f = f.replace(kp, `${kp}\n          keyboardHeight={motion.keyboardHeight}`);
      console.log("composer keyboardHeight applied");
    }
    writeFileSync(chat, f);
    console.log("composer + menu applied");
  }
}
writeFileSync(path, src);
console.log("harness applied");
