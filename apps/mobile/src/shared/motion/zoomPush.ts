import { routeMemo } from "./routeMemo";

/**
 * Build 10: the route that a ColorOS zoom-open pushes gets no native push animation.
 *
 * The zoom surface already covers the screen when the route is pushed (ZoomOpenOverlay pushes at 90%
 * and then fades its surface off the new screen). With the screen's own `slide_from_right` the
 * fading surface showed the native slide under it: two open animations. The overlay arms this module
 * just before it navigates and keeps its surface up until that route has appeared; the next new chat
 * route that the stack's options see takes animation "none" (react-native-screens runs its 20 ms no-op). When that route has appeared, the stack drops
 * the override again, so Back pops the chat with its normal animation (one animation, as before).
 */

/**
 * An armed zoom is for the push that follows it, never for a later unrelated push: the overlay disarms
 * when it clears, and this bound holds even if it never does. Generous, because a busy phone can take
 * well over a second to build the pushed screen (review R12-1: a 1 s bound let a late push slide).
 */
const ARM_MS = 3000;

let armedUntil = 0;
/** The overlay's "the zoomed route is on screen" callback, and the route it belongs to once taken. */
let onShown: (() => void) | null = null;
let shownKey: string | null = null;
/** For each route the stack has seen: true while it is a zoom push that still has its animation off. */
const pushes = routeMemo<boolean>();

/** Called by the zoom overlay right before it navigates; `shown` runs once the pushed route has appeared. */
export function armZoomPush(shown: () => void): void {
  armedUntil = Date.now() + ARM_MS;
  onShown = shown;
  shownKey = null;
}

/** The overlay has cleared: nothing later is a zoom push. */
export function disarmZoomPush(): void {
  armedUntil = 0;
  onShown = null;
  shownKey = null;
}

/**
 * For the options of a chat-like route: "none" while this route is a zoom push, else `fallback`.
 * A route key seen for the first time while armed is the pushed one; an existing route is never taken.
 */
export function zoomPushAnimation<T extends string>(routeKey: string | undefined, fallback: T): T | "none" {
  if (routeKey === undefined) return fallback;
  const zoomed = pushes.get(routeKey, () => {
    if (Date.now() >= armedUntil) return false;
    armedUntil = 0;
    shownKey = routeKey;
    return true;
  });
  return zoomed ? "none" : fallback;
}

export function isZoomPush(routeKey: string): boolean {
  return pushes.peek(routeKey) === true;
}

/**
 * The route has appeared (its opening transitionEnd): its pop takes the normal animation again, and
 * the zoom overlay is told it may fade its surface off. True when it was a zoom push.
 */
export function releaseZoomPush(routeKey: string): boolean {
  if (pushes.peek(routeKey) !== true) return false;
  pushes.set(routeKey, false);
  // The zoomed route is on screen: the overlay may uncover it now.
  if (routeKey === shownKey && onShown) {
    const shown = onShown;
    onShown = null;
    shownKey = null;
    shown();
  }
  return true;
}

/** The route has closed: forget its key, so the memo holds only routes that are on a stack. */
export function forgetZoomRoute(routeKey: string): void {
  pushes.forget(routeKey);
}
