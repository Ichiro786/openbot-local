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
 * Home stays drawn under a zoomed chat. From the tap until the chat unmounts, home pauses its two blurs:
 * the screen never runs more than two, and none re-renders under the moving chat.
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

/** An armed zoom is for the push that follows the tap, never a later unrelated push. */
const ARM_MS = 3000;
let armed: { until: number; originY: number; release: () => void; expire: ReturnType<typeof setTimeout> } | null = null;
/** The home blur pause each zoomed route holds from its tap until it unmounts (or closes). */
const homeHolds = new Map<string, () => void>();

export type LiveZoom = {
  originY: number;
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
  if (!current) return;
  clearTimeout(current.expire);
  current.release();
}

/**
 * Called by a chat row right before it navigates. Home pauses its blurs from here (the commit lands
 * with the chat's mount, before the open starts) until the chat unmounts, so no blur re-renders under
 * the moving chat. A zoom that no push takes releases home after ARM_MS.
 */
export function armLiveZoom(originY: number): void {
  dropArmed();
  armed = { until: Date.now() + ARM_MS, originY, release: holdHomeCovered(), expire: setTimeout(dropArmed, ARM_MS) };
}

/** For the options of a chat-like route: its zoom, decided the first time the route is seen. */
export function liveZoomFor(routeKey: string | undefined): LiveZoom | undefined {
  if (routeKey === undefined) return undefined;
  const zoom = routes.get(routeKey, () => {
    const current = armed;
    if (!current || Date.now() >= current.until) return false;
    armed = null;
    clearTimeout(current.expire);
    homeHolds.set(routeKey, current.release);
    return { originY: current.originY };
  });
  return zoom || undefined;
}

/** The route's zoom, without deciding it (the screen reads what its options decided). */
export function liveZoomOf(routeKey: string): LiveZoom | undefined {
  return routes.peek(routeKey) || undefined;
}

/** The zoomed chat has unmounted (or closed): home's blurs run again. */
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
