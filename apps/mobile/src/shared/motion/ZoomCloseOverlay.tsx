import { Canvas, Image, type SkImage } from "@shopify/react-native-skia";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
import { Dimensions, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  interpolate,
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { create } from "zustand";
import { snapshotNavigator } from "./ColorOSMotionRoot";
import { zoom } from "./tokens";
import type { ZoomSource } from "./zoomPush";

/**
 * Build 11.2: closing a zoom-opened chat reverses its zoom-open. A still of the chat stands in for it
 * full screen; the chat pops under it with no native animation; the still then shrinks back into the
 * home row it came from on the open's curve (the surface clip, radius, fill and dim of ZoomOpenOverlay
 * run backwards) and dissolves into the row. A row that is gone or off screen gets a scale-fade
 * toward the centre of the list instead. The still is an image, so the chat's frost is frozen for
 * the shrink and the only live blurs are the home screen's own, after the pop (≤2).
 *
 * Build 11.3 zoomfix (Back stuck on Syed's Android 17 phone): the close never decides whether the chat
 * leaves. `zoomCloseStart` answers at once (no await), the caller pops the chat itself within a hard
 * bound, and everything here is visual only: the still, the row's place and the home still arrive
 * when they arrive and are used only if they are in time. No still in time: the close plays with the
 * plain surface (the open's first half backwards), never the stack's slide. A row that cannot be
 * measured: its last known place, else the centre. The overlay never takes a touch.
 *
 * A predictive back gesture (Android 14+) shrinks the still over a still of the home screen taken when
 * the chat opened; a cancel springs back and leaves the chat as it was. All motion is on the UI thread.
 */

type Rect = { x: number; y: number; width: number; height: number };

type CloseRequest = {
  key: number;
  /** null until the capture answers (or for good, when it is late): the surface closes on its own. */
  chat: SkImage | null;
  /** Shown behind the still while a predictive gesture is undecided. */
  home: SkImage | null;
  source: ZoomSource;
};

export type ZoomCloseHandle = {
  /** Gesture progress 0..1 (before release). */
  progress: (value: number) => void;
  /**
   * Plays the close and calls `pop` once (after at most STILL_WAIT_MS, whether or not the still came).
   * The caller's own hard bound pops the chat too, so a lost `pop` never holds Back.
   */
  commit: (pop: () => void) => void;
  /** The gesture was cancelled: back to full screen, chat untouched. */
  cancel: () => void;
};

/** How far the gesture alone shrinks the chat (p 1 → 1 − PEEK) before it is released. */
const PEEK = 0.45;
/** The longest a commit waits for the still before the chat pops anyway (the surface closes alone). */
export const STILL_WAIT_MS = 120;
/** After the pop, when the row is re-measured, and the one retry when it is not there yet. */
const MEASURE_MS = 32;
const RETRY_MS = 100;
const SAFETY_MS = 1600;
const CANCEL_SPRING = { damping: 34, stiffness: 420, mass: 1 } as const;

const useCloseStore = create<{ request: CloseRequest | null }>(() => ({ request: null }));
let nextKey = 1;
let hostMounted = false;
/** The running close's finisher, so a new close (or the host) ends it at once. */
let finishCurrent: (() => void) | null = null;

/** p: 1 = full screen, 0 = on the row. Module-level so the handle drives it without a render. */
const p = makeMutable(1);
const target = makeMutable<Rect>({ x: 0, y: 0, width: 0, height: 0 });
/** 1 = the row is gone or off screen: shrink the whole still toward the centre and fade. */
const centre = makeMutable(0);
const homeShown = makeMutable(1);
/** 0 until the overlay should cover the chat (a gesture with both stills, or a commit). */
const shown = makeMutable(0);

export function zoomClosing(): boolean {
  return useCloseStore.getState().request !== null;
}

/** Skia may still draw an image for the frame after the overlay unmounts: dispose a little later. */
function disposeLater(image: SkImage | null | undefined) {
  if (image) setTimeout(() => image.dispose(), 500);
}

function usable(rect: Rect | null | undefined): rect is Rect {
  return (
    !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
  );
}

/** On screen: at least a sliver of the row is inside the window (else the centre fallback). */
function onScreen(rect: Rect): boolean {
  const { width, height } = Dimensions.get("window");
  return rect.y + rect.height > 8 && rect.y < height - 8 && rect.x + rect.width > 8 && rect.x < width - 8;
}

/**
 * Starts a close of the chat that `source` opened: answers at once. Null only when no host is
 * mounted (the caller still pops the chat). A close already running is finished first, never waited for.
 */
export function zoomCloseStart(source: ZoomSource, interactive: boolean): ZoomCloseHandle | null {
  if (!hostMounted) return null;
  finishCurrent?.();
  cancelAnimation(p);
  cancelAnimation(target);
  cancelAnimation(centre);
  cancelAnimation(shown);
  p.value = 1;
  shown.value = 0;
  homeShown.value = 1;
  const known = usable(source.rect) && onScreen(source.rect);
  target.value = usable(source.rect) ? source.rect : { x: 0, y: 0, width: 0, height: 0 };
  centre.value = known ? 0 : 1;
  const key = nextKey++;
  let committed = false;
  let popped = false;
  let finished = false;
  let safety: ReturnType<typeof setTimeout> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  const mine = () => useCloseStore.getState().request?.key === key;
  const done = () => {
    if (finished) return;
    finished = true;
    if (safety) clearTimeout(safety);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (finishCurrent === done) finishCurrent = null;
    const request = useCloseStore.getState().request;
    if (request?.key === key) {
      useCloseStore.setState({ request: null });
      // The home still is the route's (forgetZoomRoute disposes it): never disposed here.
      disposeLater(request.chat);
    }
    shown.value = 0;
  };
  finishCurrent = done;
  useCloseStore.setState({ request: { key, chat: null, home: null, source } });
  // Nothing lingers: whatever is cut off, the overlay clears.
  safety = setTimeout(done, SAFETY_MS * 4);

  // Land where the row is now (it can have moved or remounted since the open: a settings change
  // re-renders the pinned grid). Used only if it answers; never waited for.
  const land = (animate: boolean, retry: boolean) =>
    source.measure((rect) => {
      if (finished) return;
      if (!usable(rect) || !onScreen(rect)) {
        if (retry) later(() => land(animate, false), RETRY_MS);
        else if (!usable(source.rect) || !onScreen(source.rect) || rect) {
          centre.value = animate ? withTiming(1, { duration: 140 }) : 1;
        }
        return;
      }
      const t = target.value;
      const moved =
        centre.value > 0 ||
        Math.abs(rect.x - t.x) > 2 ||
        Math.abs(rect.y - t.y) > 2 ||
        Math.abs(rect.width - t.width) > 2 ||
        Math.abs(rect.height - t.height) > 2;
      if (!moved) return;
      // The open-time home still shows the row where it was; the live screen is right.
      homeShown.value = 0;
      target.value = animate ? withTiming(rect, { duration: 140 }) : rect;
      centre.value = animate ? withTiming(0, { duration: 140 }) : 0;
    });
  land(false, false);

  void snapshotNavigator().then(
    (chat) => {
      // Late (the chat already popped: the capture would show the home screen) or dropped: unused.
      if (!chat) return;
      if (finished || popped || !mine()) {
        chat.dispose();
        return;
      }
      useCloseStore.setState((s) => (s.request?.key === key ? { request: { ...s.request, chat } } : s));
    },
    () => undefined,
  );
  if (interactive) {
    void source.home.then(
      (home) => {
        if (!home || finished || committed || !mine()) return;
        // The route's source keeps owning this still (forgetZoomRoute disposes it); not disposed here.
        useCloseStore.setState((s) => (s.request?.key === key ? { request: { ...s.request, home } } : s));
      },
      () => undefined,
    );
  }

  return {
    progress: (value) => {
      if (committed || finished) return;
      const request = useCloseStore.getState().request;
      // Both stills are needed to show the gesture; until then the live chat stays as it is.
      if (request?.key !== key || !request.chat || !request.home) return;
      shown.value = 1;
      p.value = 1 - PEEK * Math.min(Math.max(value, 0), 1);
    },
    commit: (pop) => {
      if (committed || finished) return;
      committed = true;
      if (safety) clearTimeout(safety);
      safety = setTimeout(done, SAFETY_MS + STILL_WAIT_MS);
      const go = () => {
        if (popped || finished) return;
        popped = true;
        shown.value = 1;
        pop();
        p.value = withSpring(0, zoom.closeSpring, (ok) => {
          if (ok) runOnJS(done)();
        });
        later(() => land(true, true), MEASURE_MS);
        // The home still is the closing route's: drop it once the live home screen is under the shrink.
        later(() => {
          homeShown.value = 0;
          useCloseStore.setState((s) => (s.request?.key === key ? { request: { ...s.request, home: null } } : s));
        }, 200);
      };
      if (useCloseStore.getState().request?.chat) {
        go();
        return;
      }
      // Wait for the still a little (it usually answers within a frame or two), never longer.
      const unsubscribe = useCloseStore.subscribe((s) => {
        if (s.request?.key === key && s.request.chat) {
          unsubscribe();
          go();
        }
      });
      later(() => {
        unsubscribe();
        go();
      }, STILL_WAIT_MS);
    },
    cancel: () => {
      if (committed || finished) return;
      committed = true;
      if (safety) clearTimeout(safety);
      if (!mine() || shown.value === 0) {
        done();
        return;
      }
      p.value = withSpring(1, CANCEL_SPRING, () => {
        runOnJS(done)();
      });
      // Build 11.3: the still never outlives a cancel, even if the spring is cut off.
      safety = setTimeout(done, SAFETY_MS);
    },
  };
}

/** One host, a sibling after the navigator inside `ColorOSMotionRoot` (after the zoom-open host). */
export function ZoomCloseHost() {
  const request = useCloseStore((s) => s.request);
  useEffect(() => {
    hostMounted = true;
    return () => {
      hostMounted = false;
      finishCurrent?.();
    };
  }, []);
  return request ? <ZoomCloseOverlay key={request.key} request={request} /> : null;
}

function ZoomCloseOverlay({ request }: { request: CloseRequest }) {
  const { width, height } = useWindowDimensions();
  const surface = useThemeColor("background");
  const { chat, home, source } = request;
  const radius = source.radius;

  const rootStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const homeStyle = useAnimatedStyle(() => ({ opacity: homeShown.value }));
  const dim = useAnimatedStyle(() => ({ opacity: zoom.backgroundDim * Math.min(Math.max(p.value, 0), 1) }));
  const surfaceStyle = useAnimatedStyle(() => {
    const v = p.value;
    const c = centre.value;
    const t = target.value;
    // Fallback target: the centre 60% of the screen.
    const cw = width * 0.6;
    const ch = height * 0.6;
    const tx = interpolate(c, [0, 1], [t.x, (width - cw) / 2]);
    const ty = interpolate(c, [0, 1], [t.y, (height - ch) / 2]);
    const tw = interpolate(c, [0, 1], [t.width, cw]);
    const th = interpolate(c, [0, 1], [t.height, ch]);
    return {
      left: interpolate(v, [0, 1], [tx, 0]),
      top: interpolate(v, [0, 1], [ty, 0]),
      width: interpolate(v, [0, 1], [tw, width]),
      height: interpolate(v, [0, 1], [th, height]),
      borderRadius: interpolate(v, [0, 1], [interpolate(c, [0, 1], [radius, 28]), zoom.endRadius]),
      // The open's fill curve backwards: solid down to p 0.55, gone at the row.
      opacity: interpolate(v, [0, zoom.fillFade[0], zoom.fillFade[1]], [0, 0.6, 1], "clamp"),
    };
  });
  // The chat still: held at its screen place while the surface closes round it (the open's skeleton
  // backwards); toward the centre it scales with the surface instead. It hands over to the plain
  // surface fill on the way in, like the open's skeleton.
  const chatStyle = useAnimatedStyle(() => {
    const v = p.value;
    const c = centre.value;
    const t = target.value;
    const s = interpolate(v, [0, 1], [0.6, 1]);
    const heldX = -interpolate(v, [0, 1], [t.x, 0]);
    const heldY = -interpolate(v, [0, 1], [t.y, 0]);
    const scaledX = -(width * (1 - s)) / 2;
    const scaledY = -(height * (1 - s)) / 2;
    return {
      opacity: interpolate(v, [0.45, 0.9], [0, 1], "clamp"),
      transform: [
        { translateX: interpolate(c, [0, 1], [heldX, scaledX]) },
        { translateY: interpolate(c, [0, 1], [heldY, scaledY]) },
        { scale: interpolate(c, [0, 1], [1, s]) },
      ],
    };
  });

  return (
    // Build 11.3: the still never takes a touch. A close that lingers (a slow spring, a lost gesture end)
    // must not freeze the screen: taps reach the live chat (or home) under it.
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, rootStyle]}
      importantForAccessibility="no-hide-descendants"
    >
      {home ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, homeStyle]}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Image image={home} x={0} y={0} width={width} height={height} fit="fill" />
          </Canvas>
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.surface, { backgroundColor: String(surface ?? "#000") }, surfaceStyle]}
      >
        {chat ? (
          <Animated.View style={[{ width, height }, chatStyle]}>
            <Canvas style={{ width, height }}>
              <Image image={chat} x={0} y={0} width={width} height={height} fit="fill" />
            </Canvas>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: "#000" },
  surface: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
});
