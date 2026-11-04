import type { SkImage } from "@shopify/react-native-skia";
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
/**
 * Build 11.2: where a zoom-opened route came from, so its close can shrink back into the same row.
 * `measure` re-reads the row (null when it is gone); `home` is a still of the screen under it, taken
 * as the zoom started, which shows behind the chat while a predictive back gesture is still undecided.
 */
export type ZoomSource = {
  rect: { x: number; y: number; width: number; height: number };
  radius: number;
  measure: (done: (rect: ZoomSource["rect"] | null) => void) => void;
  home: Promise<SkImage | null>;
  /** The chat's id, for the zoom-open skeleton's measured sizes (zoomSkeleton). */
  skeletonKey?: string;
};
let pendingSource: ZoomSource | null = null;
const sources = new Map<string, ZoomSource>();
/** Build 11.2: routes being zoom-closed: their pop takes no native animation (the overlay plays it). */
const closing = new Set<string>();

/** For each route the stack has seen: true while it is a zoom push that still has its animation off. */
const pushes = routeMemo<boolean>();

/** Called by the zoom overlay right before it navigates; `shown` runs once the pushed route has appeared. */
export function armZoomPush(shown: () => void, source: ZoomSource | null = null): void {
  armedUntil = Date.now() + ARM_MS;
  onShown = shown;
  disposeSource(pendingSource);
  pendingSource = source;
  shownKey = null;
}

/** The overlay has cleared: nothing later is a zoom push. */
export function disarmZoomPush(): void {
  armedUntil = 0;
  onShown = null;
  shownKey = null;
  disposeSource(pendingSource);
  pendingSource = null;
}

/**
 * Build 11.3 zoomfix: a closing overlay can still draw the home still for a moment after the route
 * closes (it drops it 200 ms after the pop): dispose well after that.
 */
const DISPOSE_LATER_MS = 2000;
function disposeSource(source: ZoomSource | null): void {
  void source?.home.then((image) => {
    if (image) setTimeout(() => image.dispose(), DISPOSE_LATER_MS);
  });
}

/**
 * For the options of a chat-like route: "none" while this route is a zoom push, else `fallback`.
 * A route key seen for the first time while armed is the pushed one; an existing route is never taken.
 */
export function zoomPushAnimation<T extends string>(routeKey: string | undefined, fallback: T): T | "none" {
  if (routeKey === undefined) return fallback;
  if (closing.has(routeKey)) return "none";
  const zoomed = pushes.get(routeKey, () => {
    if (Date.now() >= armedUntil) return false;
    armedUntil = 0;
    shownKey = routeKey;
    if (pendingSource) sources.set(routeKey, pendingSource);
    pendingSource = null;
    return true;
  });
  return zoomed ? "none" : fallback;
}

export function isZoomPush(routeKey: string): boolean {
  return pushes.peek(routeKey) === true;
}

/**
 * The route has appeared (its opening transitionEnd): its pop takes the normal animation again.
 * True when it was a zoom push. Build 11: the overlay no longer uncovers on this (transitionEnd comes
 * before the chat has painted its rows); it waits for `markZoomContentReady`.
 */
export function releaseZoomPush(routeKey: string): boolean {
  if (pushes.peek(routeKey) !== true) return false;
  pushes.set(routeKey, false);
  return true;
}

/**
 * Build 11: the zoom-pushed chat has painted (header, composer and its revealed list or empty state).
 * The overlay dissolves its surface off it once. Any other route is ignored.
 */
export function markZoomContentReady(routeKey: string): void {
  if (routeKey !== shownKey || !onShown) return;
  const shown = onShown;
  onShown = null;
  shownKey = null;
  shown();
}

/** The route has closed: forget its key, so the memo holds only routes that are on a stack. */
export function forgetZoomRoute(routeKey: string): void {
  pushes.forget(routeKey);
  closing.delete(routeKey);
  disposeSource(sources.get(routeKey) ?? null);
  sources.delete(routeKey);
}

/** Build 11.2: the row a zoom-opened route came from (undefined for any other route). */
export function zoomSource(routeKey: string): ZoomSource | undefined {
  return sources.get(routeKey);
}

/** Build 11.2: the closing overlay owns the source (and disposes its still) from here on. */
export function takeZoomSource(routeKey: string): ZoomSource | undefined {
  const source = sources.get(routeKey);
  sources.delete(routeKey);
  return source;
}

/** Build 11.2: this route is being zoom-closed; the caller re-reads its options before it pops. */
export function markZoomClosing(routeKey: string): void {
  closing.add(routeKey);
}

/** Build 11.3 zoomfix: the route is in front again (its close did not take it): normal options. */
export function unmarkZoomClosing(routeKey: string): boolean {
  return closing.delete(routeKey);
}

/**
 * Build 11.3 zoomfix: every zoom row on screen, by the chat it opens. A row can remount (a settings
 * change re-renders the pinned grid, a list recycles) between the open and the close: the close finds
 * the chat's current row here, pinned or not.
 */
type MeasurableRow = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};
const rows = new Map<string, Set<{ current: MeasurableRow | null }>>();

export function registerZoomRow(chatId: string, ref: { current: MeasurableRow | null }): () => void {
  let set = rows.get(chatId);
  if (!set) {
    set = new Set();
    rows.set(chatId, set);
  }
  set.add(ref);
  return () => {
    const current = rows.get(chatId);
    current?.delete(ref);
    if (current?.size === 0) rows.delete(chatId);
  };
}

/**
 * Measures the chat's row: `preferred` (the row it opened from) first, then any other row now showing
 * that chat. `done(null)` when none answers with a size. A row whose measure never answers stalls only
 * this lookup (the caller never waits on it).
 */
export function measureZoomRow(
  chatId: string | undefined,
  preferred: MeasurableRow | null,
  done: (rect: ZoomSource["rect"] | null) => void,
): void {
  const list: MeasurableRow[] = preferred ? [preferred] : [];
  for (const ref of (chatId && rows.get(chatId)) || []) {
    if (ref.current && ref.current !== preferred) list.push(ref.current);
  }
  const next = (index: number) => {
    const row = list[index];
    if (!row) {
      done(null);
      return;
    }
    try {
      row.measureInWindow((x, y, width, height) =>
        width && height && Number.isFinite(x) && Number.isFinite(y) ? done({ x, y, width, height }) : next(index + 1),
      );
    } catch {
      next(index + 1);
    }
  };
  next(0);
}
