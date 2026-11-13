import { createContext, useContext, useSyncExternalStore } from "react";
import { routeMemo } from "./routeMemo";

/**
 * Build 11.3 simple zoom: a ColorOS chat opens and closes by animating the LIVE screens (no stills, no
 * overlay surface). A row tap arms the zoom with the tap's height on screen; the next new chat route
 * the stack's options see takes it: that route is a transparent modal with no native animation, so
 * home stays drawn under it, and the chat's own root (LiveZoomScreen) grows in from the tap, and
 * shrinks back on Back or with the predictive back gesture. Every other route is unchanged.
 */

/**
 * Home stays drawn under a zoomed chat. Build 14: home pauses its two blurs only while the open chat
 * covers it (from the open's end, when the chat's own frosts start, to the close's start, when they stop),
 * so the screen never runs more than two and the tap itself re-renders nothing on home (build 12 videos:
 * the home search bar redrew on the tap frame, then home froze 133-342 ms before the open started).
 */
let covering = 0;
const watchers = new Set<() => void>();

function notify(): void {
  for (const watch of watchers) watch();
}

function holdHomeCovered(): () => void {
  covering += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    covering -= 1;
    notify();
  };
}

function subscribe(watch: () => void): () => void {
  watchers.add(watch);
  return () => watchers.delete(watch);
}

function homeCovered(): boolean {
  return covering > 0;
}

export function useHomeCovered(): boolean {
  return useSyncExternalStore(subscribe, homeCovered);
}

/**
 * Build 14: the tapped element's rect in the window (a row, or a pinned agent's tile), which the chat grows
 * out of as an opaque card and shrinks back into.
 */
export type ZoomOrigin = { x: number; y: number; width: number; height: number };
/** Measures a source element now (callback with its window rect); undefined once it unmounted. */
type MeasureSource = (done: (rect: ZoomOrigin) => void) => void;
/** Every mounted zoom source, by chat: a close re-finds its element by the chat's id. */
const sources = new Map<string, Set<MeasureSource>>();

/** Called by a chat row while mounted: the zoom of that chat can find it again for its close. */
export function registerZoomSource(chatId: string, measure: MeasureSource): () => void {
  let set = sources.get(chatId);
  if (!set) {
    set = new Set();
    sources.set(chatId, set);
  }
  set.add(measure);
  return () => {
    const current = sources.get(chatId);
    current?.delete(measure);
    if (current?.size === 0) sources.delete(chatId);
  };
}

/**
 * The element a closing chat shrinks into, measured now: the element it opened from when still mounted,
 * else any element of the same chat. Nothing when none is mounted (the close keeps the open's rect).
 */
export function resolveZoomOrigin(zoom: LiveZoom, done: (rect: ZoomOrigin) => void): void {
  const accept = (rect: ZoomOrigin) => {
    if (rect.width > 0 && rect.height > 0) done(rect);
  };
  const own = zoom.measure;
  const set = zoom.chatId !== undefined ? sources.get(zoom.chatId) : undefined;
  if (own && set?.has(own)) own(accept);
  else {
    const [first] = set ?? [];
    first?.(accept);
  }
}

/** An armed zoom is for the push that follows the tap, never a later unrelated push. */
const ARM_MS = 3000;
let armed: {
  until: number;
  origin: ZoomOrigin;
  chatId?: string;
  measure?: MeasureSource;
  expire: ReturnType<typeof setTimeout>;
} | null = null;
/** The home blur pause each zoomed route holds from its tap until it unmounts (or closes). */
const homeHolds = new Map<string, () => void>();

export type LiveZoom = {
  /** The tapped element's window rect (updated in place when a close re-finds it). */
  origin: ZoomOrigin;
  chatId?: string;
  measure?: MeasureSource;
  /**
   * Set once a screen was pushed over the chat. react-native-screens then detaches home under the
   * transparent chat and does not attach it again when the chat is back in front, so a live close would
   * fade the chat over black (e2e 42084677042, stuck lanes 3 and 8). From then on the chat closes the
   * stack's way: its pop takes the chat route's normal animation, which brings home back natively.
   */
  nativeClose?: boolean;
};
/** For each chat route the stack has seen: its zoom, or false (decided once, when first seen). */
const routes = routeMemo<LiveZoom | false>();

function dropArmed(): void {
  const current = armed;
  armed = null;
  if (current) clearTimeout(current.expire);
}

/**
 * Called by a chat row right before it navigates: plain module state, nothing on home renders. A zoom
 * that no push takes is dropped after ARM_MS.
 */
export function armLiveZoom(origin: ZoomOrigin, chatId?: string, measure?: MeasureSource): void {
  dropArmed();
  armed = {
    until: Date.now() + ARM_MS,
    origin,
    chatId,
    measure,
    expire: setTimeout(dropArmed, ARM_MS),
  };
}

/** For the options of a chat-like route: its zoom, decided the first time the route is seen. */
export function liveZoomFor(routeKey: string | undefined): LiveZoom | undefined {
  if (routeKey === undefined) return undefined;
  const zoom = routes.get(routeKey, () => {
    const current = armed;
    if (!current || Date.now() >= current.until) return false;
    armed = null;
    clearTimeout(current.expire);
    return { origin: current.origin, chatId: current.chatId, measure: current.measure };
  });
  return zoom || undefined;
}

/** The route's zoom, without deciding it (the screen reads what its options decided). */
export function liveZoomOf(routeKey: string): LiveZoom | undefined {
  return routes.peek(routeKey) || undefined;
}

/** The zoomed chat's open has ended and covers home: home's blurs pause (once per route). */
export function coverLiveZoomHome(routeKey: string): void {
  if (!homeHolds.has(routeKey)) homeHolds.set(routeKey, holdHomeCovered());
}

/** The zoomed chat starts its close (or unmounted, or closed): home's blurs run again. */
export function releaseLiveZoomHome(routeKey: string): void {
  const release = homeHolds.get(routeKey);
  homeHolds.delete(routeKey);
  release?.();
}

/** The route has closed (its closing transitionEnd). */
export function forgetLiveZoom(routeKey: string): void {
  routes.forget(routeKey);
  releaseLiveZoomHome(routeKey);
}

/**
 * Whether the chat's zoom open has settled. True on every screen that did not zoom open. Work that would
 * commit or re-render a blur during the open (the frosts, deferred row content) waits for it, so the
 * open's frames are transform and opacity on the UI thread only.
 */
export const LiveZoomSettledContext = createContext(true);
export function useLiveZoomSettled(): boolean {
  return useContext(LiveZoomSettledContext);
}
