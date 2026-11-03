/**
 * Build 10: the route that a ColorOS zoom-open pushes gets no native push animation.
 *
 * The zoom surface already covers the screen when the route is pushed (ZoomOpenOverlay pushes at 90%
 * and then fades its surface off the new screen). With the screen's own `slide_from_right` the
 * fading surface showed the native slide under it: two open animations. The overlay arms this module
 * just before it navigates; the next new chat route that the stack's options see takes animation
 * "none" (react-native-screens runs its 20 ms no-op). When that route has appeared, the stack drops
 * the override again, so Back pops the chat with its normal animation (one animation, as before).
 */

/** An armed zoom is for the push that follows it at once, never for a later unrelated push. */
const ARM_MS = 1000;

let armedUntil = 0;
/** Route keys that the stack's options have seen, so an existing route is never taken. */
const seen = new Set<string>();
/** Routes pushed by a zoom that still have their animation turned off. */
const zoomed = new Set<string>();

/** Called by the zoom overlay right before it runs the navigation. */
export function armZoomPush(): void {
  armedUntil = Date.now() + ARM_MS;
}

/**
 * For the options of a chat-like route: "none" while this route is a zoom push, else `fallback`.
 * A route key seen for the first time while armed is the pushed one.
 */
export function zoomPushAnimation<T extends string>(routeKey: string | undefined, fallback: T): T | "none" {
  if (routeKey === undefined) return fallback;
  if (!seen.has(routeKey)) {
    seen.add(routeKey);
    if (Date.now() < armedUntil) {
      armedUntil = 0;
      zoomed.add(routeKey);
    }
  }
  return zoomed.has(routeKey) ? "none" : fallback;
}

/** The route has closed: forget its key, so the set holds only routes that are on a stack. */
export function forgetZoomRoute(routeKey: string): void {
  seen.delete(routeKey);
  zoomed.delete(routeKey);
}

export function isZoomPush(routeKey: string): boolean {
  return zoomed.has(routeKey);
}

/** The route has appeared: its pop takes the normal animation again. True when it was a zoom push. */
export function releaseZoomPush(routeKey: string): boolean {
  return zoomed.delete(routeKey);
}
