import { Canvas, Image, type SkImage } from "@shopify/react-native-skia";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
import { Dimensions, Keyboard, StyleSheet, useColorScheme, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Uniwind } from "uniwind";
import { create } from "zustand";
import { snapshotNavigator } from "./ColorOSMotionRoot";
import { zoom } from "./tokens";
import { type ZoomSource, zoomMotionCount, zoomOpenSurfaceUp } from "./zoomPush";
import { keepChatStill } from "./zoomSkeleton";

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
  /** A predictive gesture: until its home still comes, a plain backdrop stands behind the preview. */
  interactive: boolean;
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

/**
 * Build 11.3 motion B1 (audit N08, Android predictive back spec): the undecided gesture previews the
 * chat at most at 90 % scale, shifted (W/20 − 8) dp toward the swipe, and its progress goes through
 * STANDARD_DECELERATE (0, 0, 0, 1) so the start of the swipe is the most visible part. (Was: linear,
 * the surface shrank toward the row down to 55 %.) The commit then closes from that preview.
 */
const PREVIEW_SCALE = 0.1;
/** Build 11.3 council C11: the chat still fades over the last 30 % of the close (the live row shows through). */
const CHAT_FADE_END = 0.3;
const decelerate = Easing.bezierFn(0, 0, 0, 1);
/** The longest a commit waits for the still before the chat pops anyway (the surface closes alone). */
export const STILL_WAIT_MS = 120;
/** After the pop, when the row is re-measured, and the one retry when it is not there yet. */
const MEASURE_MS = 32;
const RETRY_MS = 100;
const SAFETY_MS = 1600;

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
/** The predictive gesture's preview, 0..1 (already decelerated), and its direction (+1 left edge, −1 right). */
const preview = makeMutable(0);
const previewSide = makeMutable(1);

/**
 * Build 11.3 motion B3: the header Back's still, started on press-in, so the close has it when the tap
 * lands and starts on that frame (a tap is ~50-150 ms). Used once, within WARM_MS, else disposed.
 */
const WARM_MS = 400;
let warm: { at: number; still: Promise<SkImage | null> } | null = null;

function disposeStill(still: Promise<SkImage | null>) {
  void still.then(
    (image) => disposeLater(image),
    () => undefined,
  );
}

export function prewarmZoomClose() {
  if (!hostMounted || warm) return;
  const entry = { at: Date.now(), still: snapshotNavigator() };
  warm = entry;
  setTimeout(() => {
    if (warm !== entry) return;
    warm = null;
    disposeStill(entry.still);
  }, WARM_MS);
}

function takeWarm(): Promise<SkImage | null> | null {
  const entry = warm;
  warm = null;
  if (!entry) return null;
  if (Date.now() - entry.at < WARM_MS) return entry.still;
  disposeStill(entry.still);
  return null;
}

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
export function zoomCloseStart(
  source: ZoomSource,
  interactive: boolean,
  edge = 0,
  /** Build 11.3 council A4: the chat's list shows its end (only then is its still kept for the next open). */
  atEnd = false,
): ZoomCloseHandle | null {
  if (!hostMounted) return null;
  finishCurrent?.();
  cancelAnimation(p);
  cancelAnimation(preview);
  preview.value = 0;
  // BackEventCompat.EDGE_LEFT = 0: a swipe from the left edge moves the preview right.
  previewSide.value = edge === 1 ? -1 : 1;
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
  // Build 11.3 motion (open hand-off): a close that pops keeps its still for this chat's next zoom-open.
  // Not with the keyboard up (the reopened chat has it down, and the still would show the gap), nor while
  // the open's surface is still on screen (the window still would show it).
  const { width: stillWidth, height: stillHeight } = Dimensions.get("window");
  // Nor when the list was scrolled up: the reopened chat lands at its end and would jump from the still.
  const keepAs =
    source.skeletonKey && atEnd && !Keyboard.isVisible() && !zoomOpenSurfaceUp() ? source.skeletonKey : null;
  const stillTheme = Uniwind.currentTheme;
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
      if (popped && keepAs && request.chat)
        keepChatStill(keepAs, { image: request.chat, width: stillWidth, height: stillHeight, theme: stillTheme });
      else disposeLater(request.chat);
    }
    shown.value = 0;
  };
  finishCurrent = done;
  useCloseStore.setState({ request: { key, chat: null, home: null, source, interactive } });
  /** Build 11.3 council A2: the gesture's latest progress, applied as soon as the chat still is there. */
  let lastProgress = 0;
  const showPreview = () => {
    shown.value = 1;
    preview.value = decelerate(Math.min(Math.max(lastProgress, 0), 1));
  };
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
          centre.value = animate ? withSpring(1, zoom.closeSpring) : 1;
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
      // The open-time home still shows the row where it was; the live screen is right (once the chat
      // popped: before that the still, or the backdrop, is all that stands behind a gesture's preview).
      if (popped) homeShown.value = 0;
      // Build 11.3 motion (open/close polish): the retarget springs on the close's own curve (keeps its
      // velocity) instead of a 140 ms timing that kinked the running close.
      target.value = animate ? withSpring(rect, zoom.closeSpring) : rect;
      centre.value = animate ? withSpring(0, zoom.closeSpring) : 0;
    });
  land(false, false);

  void (takeWarm() ?? snapshotNavigator()).then(
    (chat) => {
      // Late (the chat already popped: the capture would show the home screen) or dropped: unused.
      if (!chat) return;
      if (finished || popped || !mine()) {
        chat.dispose();
        return;
      }
      useCloseStore.setState((s) => (s.request?.key === key ? { request: { ...s.request, chat } } : s));
      // A finger that already moved (and may now hold still) gets its preview at once.
      if (interactive && !committed && lastProgress > 0) showPreview();
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
      lastProgress = value;
      const request = useCloseStore.getState().request;
      // Build 11.3 council A2: the preview starts with the chat still alone (it no longer waits for the
      // home still, which kept the swipe dead until release); without the home still a plain backdrop
      // stands behind it. Until the chat still comes (a frame or two) the live chat stays as it is.
      if (request?.key !== key || !request.chat) return;
      showPreview();
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
        // A released gesture closes from its preview: the preview springs out with the same curve.
        if (preview.value > 0) preview.value = withSpring(0, zoom.closeSpring);
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
      p.value = withSpring(1, zoom.cancelSpring);
      preview.value = withSpring(0, zoom.cancelSpring, () => {
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

/**
 * Build 11.3 council C11 (was B4, one Skia canvas redrawn on the UI thread every frame: half-rate closes
 * on the phone). The close is now the zoom-open's own view structure played backwards: the surface is an
 * Animated.View (rect + radius, clipping), and each still is a Skia canvas drawn ONCE inside a view that
 * only moves, scales and fades. No GL work on the UI thread per frame. The chat still is scaled with the
 * surface (0.62 → 1 about its centre, a zoom rather than a crop) and fades over the last 30 %, so the
 * live row shows through as it lands.
 */
function ZoomCloseOverlay({ request }: { request: CloseRequest }) {
  const { width, height } = useWindowDimensions();
  const surface = String(useThemeColor("background") ?? "#000");
  const dark = useColorScheme() === "dark";
  const { chat, home, source, interactive } = request;
  // Build 11.3 council A7: animated avatars hold their frame while the close is on screen.
  useEffect(() => {
    zoomMotionCount.value = zoomMotionCount.value + 1;
    return () => {
      zoomMotionCount.value = Math.max(0, zoomMotionCount.value - 1);
    };
  }, []);
  const radius = source.radius;

  // The surface rect for p (1 = full screen, 0 = on the row; toward the centre 60 % when c = 1).
  const surfaceStyle = useAnimatedStyle(() => {
    const v = p.value;
    const c = centre.value;
    const t = target.value;
    const cw = width * 0.6;
    const ch = height * 0.6;
    const tx = interpolate(c, [0, 1], [t.x, (width - cw) / 2]);
    const ty = interpolate(c, [0, 1], [t.y, (height - ch) / 2]);
    const tw = interpolate(c, [0, 1], [t.width, cw]);
    const th = interpolate(c, [0, 1], [t.height, ch]);
    const k = Math.min(Math.max(v, 0), 1);
    return {
      left: interpolate(v, [0, 1], [tx, 0]),
      top: interpolate(v, [0, 1], [ty, 0]),
      width: interpolate(v, [0, 1], [tw, width]),
      height: interpolate(v, [0, 1], [th, height]),
      borderRadius: interpolate(v, [0, 1], [interpolate(c, [0, 1], [radius, 28]), zoom.endRadius]),
      // A hairline rim so the card reads over a dark home; gone at full screen.
      borderColor: dark ? `rgba(255,255,255,${0.1 * (1 - k)})` : `rgba(0,0,0,${0.06 * (1 - k)})`,
      // The predictive preview (B1), about the surface's centre.
      transform: [
        { translateX: preview.value * previewSide.value * (width / 20 - 8) },
        { scale: 1 - PREVIEW_SCALE * preview.value },
      ],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: zoom.backgroundDim * Math.min(Math.max(p.value, 0), 1) }));
  // The open's fill curve backwards: solid down to p 0.55, gone at the row.
  const fillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, zoom.fillFade[0], zoom.fillFade[1]], [0, 0.6, 1], "clamp"),
  }));
  // The still: scaled with the surface about its centre (0.62 at the row), fading over the last 30 %.
  const stillStyle = useAnimatedStyle(() => {
    const v = p.value;
    const c = centre.value;
    const t = target.value;
    const tw = interpolate(c, [0, 1], [t.width, width * 0.6]);
    const th = interpolate(c, [0, 1], [t.height, height * 0.6]);
    const w = interpolate(v, [0, 1], [tw, width]);
    const h = interpolate(v, [0, 1], [th, height]);
    return {
      opacity: interpolate(v, [0, CHAT_FADE_END], [0, 1], "clamp"),
      transform: [
        { translateX: (w - width) / 2 },
        { translateY: (h - height) / 2 },
        { scale: interpolate(v, [0, 1], [zoom.destFromScale, 1], "clamp") },
      ],
    };
  });
  const homeStyle = useAnimatedStyle(() => ({ opacity: homeShown.value }));
  const shownStyle = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    // Build 11.3: the still never takes a touch. A close that lingers (a slow spring, a lost gesture end)
    // must not freeze the screen: taps reach the live chat (or home) under it.
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, shownStyle]}
      importantForAccessibility="no-hide-descendants"
    >
      {home ? (
        <Animated.View style={[StyleSheet.absoluteFill, homeStyle]}>
          <Canvas style={{ width, height }}>
            <Image image={home} x={0} y={0} width={width} height={height} fit="fill" />
          </Canvas>
        </Animated.View>
      ) : interactive ? (
        // Build 11.3 council A2: no home still yet: a plain backdrop behind the preview (never the live
        // chat round its own shrinking still); it leaves with the home still, 200 ms after the pop.
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: surface }, homeStyle]} />
      ) : null}
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: surface }, fillStyle]} />
        {chat ? (
          <Animated.View style={[{ width, height }, stillStyle]}>
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
  surface: {
    position: "absolute",
    overflow: "hidden",
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
