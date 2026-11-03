import { createContext } from "react";
import { isAndroid } from "@/shared/lib/platform";
import { colorOSMotionEnabled } from "@/shared/motion/useColorOSMotion";

/**
 * Build 10 (ColorOS motion, Android): the agent info route opens as the full-screen agent page that
 * slides in from the right (Manus Cue) instead of the 0.85 form sheet. The choice is made once per
 * route instance, when the stack first sees it, so turning ColorOS motion on or off never changes a
 * mounted screen. The root stack's options and the route's own layout read the same answer.
 */
const choices = new Map<string, boolean>();

export function agentPageFullScreen(routeKey: string | undefined): boolean {
  if (routeKey === undefined) return isAndroid && colorOSMotionEnabled();
  let full = choices.get(routeKey);
  if (full === undefined) {
    full = isAndroid && colorOSMotionEnabled();
    choices.set(routeKey, full);
  }
  return full;
}

/** The route has closed; its answer is not needed again. */
export function forgetAgentPage(routeKey: string | undefined): void {
  if (routeKey !== undefined) choices.delete(routeKey);
}

/** Provided by the agent info route's layout: whether this route instance is the full-screen page. */
export const AgentPageFullContext = createContext(false);
