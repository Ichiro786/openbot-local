// Applies the E2E harness onto the checked-out target ref (CI only).
import { cpSync, readFileSync, writeFileSync } from "node:fs";

cpSync(".github/e2e/harness/app", "apps/mobile/src/app", { recursive: true });
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
writeFileSync(path, src);
console.log("harness applied");
