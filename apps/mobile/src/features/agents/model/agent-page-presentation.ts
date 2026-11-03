import { createContext } from "react";
import { isAndroid } from "@/shared/lib/platform";
import { routeMemo } from "@/shared/motion/routeMemo";
import { colorOSMotionEnabled } from "@/shared/motion/useColorOSMotion";

/**
 * Build 10 (ColorOS motion, Android): the agent info route opens as the full-screen agent page that
 * slides in from the right (Manus Cue) instead of the 0.85 form sheet. The choice is made once per
 * route instance, when the stack first sees it, so turning ColorOS motion on or off never changes a
 * mounted screen. The root stack's options and the route's own layout read the same answer.
 */
const choices = routeMemo<boolean>();
const decide = () => isAndroid && colorOSMotionEnabled();

export function agentPageFullScreen(routeKey: string | undefined): boolean {
  return routeKey === undefined ? decide() : choices.get(routeKey, decide);
}

/** The route has closed; its answer is not needed again. */
export function forgetAgentPage(routeKey: string | undefined): void {
  if (routeKey !== undefined) choices.forget(routeKey);
}

/** Provided by the agent info route's layout: whether this route instance is the full-screen page. */
export const AgentPageFullContext = createContext(false);
