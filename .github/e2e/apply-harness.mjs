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
                            if (__e2eIsZoomPush(route.key)) setTimeout(release, 500);
                          },
                        };
                      }}
                    />`,
  );
  console.log("build 10 harness variant applied");
}
writeFileSync(path, src);
console.log("harness applied");
