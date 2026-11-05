import { Canvas, Group, Image, type SkImage, Skia, Rect as SkiaRect, vec } from "@shopify/react-native-skia";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
import { Dimensions, StyleSheet, useWindowDimensions } from "react-native";
import {
  cancelAnimation,
  Easing,
  interpolate,
  makeMutable,
  runOnJS,
  useDerivedValue,
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

/**
 * Build 11.3 motion B1 (audit N08, Android predictive back spec): the undecided gesture previews the
 * chat at most at 90 % scale, shifted (W/20 − 8) dp toward the swipe, and its progress goes through
 * STANDARD_DECELERATE (0, 0, 0, 1) so the start of the swipe is the most visible part. (Was: linear,
 * the surface shrank toward the row down to 55 %.) The commit then closes from that preview.
 */
const PREVIEW_SCALE = 0.1;
const decelerate = Easing.bezierFn(0, 0, 0, 1);
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
export function zoomCloseStart(source: ZoomSource, interactive: boolean, edge = 0): ZoomCloseHandle | null {
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

  void (takeWarm() ?? snapshotNavigator()).then(
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
      preview.value = decelerate(Math.min(Math.max(value, 0), 1));
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
      p.value = withSpring(1, CANCEL_SPRING);
      preview.value = withSpring(0, CANCEL_SPRING, () => {
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
 * Build 11.3 motion B4 (audit F08/N04/N15): the whole close is one Skia canvas. The surface is an
 * animated rounded-rect clip and the still is drawn inside it, so a frame is a redraw of the canvas on
 * the UI thread: no left/top/width/height on a view, so no ShadowTree commit and no Yoga layout per
 * frame next to React's own commits. The still now stays to the end of the close (it fades only over
 * the last 15 %, N15), so the chat itself collapses into its row instead of a plain card.
 */
function ZoomCloseOverlay({ request }: { request: CloseRequest }) {
  const { width, height } = useWindowDimensions();
  const surface = String(useThemeColor("background") ?? "#000");
  const { chat, home, source } = request;
  const radius = source.radius;

  // The surface rect for p (1 = full screen, 0 = on the row; toward the centre 60 % when c = 1).
  const box = useDerivedValue(() => {
    const v = p.value;
    const c = centre.value;
    const t = target.value;
    const cw = width * 0.6;
    const ch = height * 0.6;
    const tx = interpolate(c, [0, 1], [t.x, (width - cw) / 2]);
    const ty = interpolate(c, [0, 1], [t.y, (height - ch) / 2]);
    const tw = interpolate(c, [0, 1], [t.width, cw]);
    const th = interpolate(c, [0, 1], [t.height, ch]);
    return {
      x: interpolate(v, [0, 1], [tx, 0]),
      y: interpolate(v, [0, 1], [ty, 0]),
      w: interpolate(v, [0, 1], [tw, width]),
      h: interpolate(v, [0, 1], [th, height]),
      r: interpolate(v, [0, 1], [interpolate(c, [0, 1], [radius, 28]), zoom.endRadius]),
    };
  });
  const clip = useDerivedValue(() => {
    const b = box.value;
    return Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), b.r, b.r);
  });
  // The predictive preview (B1): about the surface's centre.
  const origin = useDerivedValue(() => vec(box.value.x + box.value.w / 2, box.value.y + box.value.h / 2));
  const previewTransform = useDerivedValue(() => [
    { translateX: preview.value * previewSide.value * (width / 20 - 8) },
    { scale: 1 - PREVIEW_SCALE * preview.value },
  ]);
  const dimOpacity = useDerivedValue(() => zoom.backgroundDim * Math.min(Math.max(p.value, 0), 1));
  // The open's fill curve backwards: solid down to p 0.55, gone at the row.
  const fillOpacity = useDerivedValue(() =>
    interpolate(p.value, [0, zoom.fillFade[0], zoom.fillFade[1]], [0, 0.6, 1], "clamp"),
  );
  const chatOpacity = useDerivedValue(() => interpolate(p.value, [0, 0.15], [0, 1], "clamp"));
  // The still: held at its screen place while the surface closes round it; toward the centre it
  // scales with the surface instead (60 % → 100 %), centred on it.
  const still = useDerivedValue(() => {
    const c = centre.value;
    const b = box.value;
    const s = interpolate(p.value, [0, 1], [0.6, 1]);
    return {
      x: interpolate(c, [0, 1], [0, b.x + b.w / 2 - (width * s) / 2]),
      y: interpolate(c, [0, 1], [0, b.y + b.h / 2 - (height * s) / 2]),
      w: interpolate(c, [0, 1], [width, width * s]),
      h: interpolate(c, [0, 1], [height, height * s]),
    };
  });
  const stillX = useDerivedValue(() => still.value.x);
  const stillY = useDerivedValue(() => still.value.y);
  const stillW = useDerivedValue(() => still.value.w);
  const stillH = useDerivedValue(() => still.value.h);

  return (
    // Build 11.3: the still never takes a touch. A close that lingers (a slow spring, a lost gesture end)
    // must not freeze the screen: taps reach the live chat (or home) under it.
    <Canvas pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
      <Group opacity={shown}>
        {home ? (
          <Group opacity={homeShown}>
            <Image image={home} x={0} y={0} width={width} height={height} fit="fill" />
          </Group>
        ) : null}
        <SkiaRect x={0} y={0} width={width} height={height} color="#000" opacity={dimOpacity} />
        <Group origin={origin} transform={previewTransform}>
          <Group clip={clip}>
            <SkiaRect x={0} y={0} width={width} height={height} color={surface} opacity={fillOpacity} />
            {chat ? (
              <Group opacity={chatOpacity}>
                <Image image={chat} x={stillX} y={stillY} width={stillW} height={stillH} fit="fill" />
              </Group>
            ) : null}
          </Group>
        </Group>
      </Group>
    </Canvas>
  );
}
