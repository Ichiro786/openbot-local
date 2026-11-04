import { Canvas, Image, type SkImage } from "@shopify/react-native-skia";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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
 * run backwards) and dissolves into the row. A row that is gone (deleted, scrolled away, recycled)
 * gets a scale-fade toward the centre instead. The still is an image, so the chat's frost is frozen
 * for the shrink and the only live blurs are the home screen's own, after the pop (≤2).
 *
 * A predictive back gesture (Android 14+) holds the close open: the still follows the gesture over a
 * still of the home screen taken when the chat opened, and only a release pops the chat; a cancel
 * springs back to full screen and leaves the chat as it was. All motion is on the UI thread.
 */

type Rect = { x: number; y: number; width: number; height: number };

type CloseRequest = {
  key: number;
  chat: SkImage;
  /** Shown behind until the pop; null when the open took none (the gesture then waits for release). */
  home: SkImage | null;
  source: ZoomSource;
  pop: () => void;
};

export type ZoomCloseHandle = {
  /** Gesture progress 0..1 (before release). */
  progress: (value: number) => void;
  /** Released past the threshold (or a plain Back): pop the chat and finish the shrink. */
  commit: () => void;
  /** The gesture was cancelled: back to full screen, chat untouched. */
  cancel: () => void;
};

/** How far the gesture alone shrinks the chat (p 1 → 1 − PEEK) before it is released. */
const PEEK = 0.45;
/** After the pop, when the row is re-measured, and the one retry when it is not there yet. */
const MEASURE_MS = 32;
const RETRY_MS = 100;
const SAFETY_MS = 1600;
const CANCEL_SPRING = { damping: 34, stiffness: 420, mass: 1 } as const;

const useCloseStore = create<{ request: CloseRequest | null }>(() => ({ request: null }));
let nextKey = 1;
let hostMounted = false;

/** p: 1 = full screen, 0 = on the row. Module-level so the handle drives it without a render. */
const p = makeMutable(1);
const target = makeMutable<Rect>({ x: 0, y: 0, width: 0, height: 0 });
/** 1 = the row is gone: shrink the whole still toward the centre and fade. */
const centre = makeMutable(0);
const homeShown = makeMutable(1);

export function zoomClosing(): boolean {
  return useCloseStore.getState().request !== null;
}

/** Skia may still draw an image for the frame after the overlay unmounts: dispose a little later. */
function disposeLater(image: SkImage | null | undefined) {
  if (image) setTimeout(() => image.dispose(), 500);
}

function clearCancelled(key: number) {
  const request = useCloseStore.getState().request;
  if (request?.key !== key) return;
  useCloseStore.setState({ request: null });
  disposeLater(request.chat);
}

/**
 * Takes the still of the chat and covers the screen with it. `pop` must take the route's source
 * (takeZoomSource) before it pops, so the route's close does not dispose the home still in use.
 * Null (the caller pops normally) when no host is mounted, a close is already running, or the
 * capture fails.
 */
export async function zoomCloseBegin(
  source: ZoomSource,
  pop: () => void,
  interactive: boolean,
): Promise<ZoomCloseHandle | null> {
  if (!hostMounted || zoomClosing()) return null;
  const [chat, home] = await Promise.all([snapshotNavigator(), interactive ? source.home : Promise.resolve(null)]);
  if (!chat || !hostMounted || zoomClosing()) {
    chat?.dispose();
    return null;
  }
  cancelAnimation(p);
  p.value = 1;
  target.value = source.rect;
  centre.value = 0;
  homeShown.value = 1;
  const key = nextKey++;
  let committed = false;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    const request = useCloseStore.getState().request;
    if (request?.key !== key) return;
    useCloseStore.setState({ request: null });
    disposeLater(request.chat);
    // Committed: the caller took the source from its route, so its home still is this close's now.
    if (committed) void source.home.then(disposeLater);
  };
  useCloseStore.setState({ request: { key, chat, home: interactive ? home : null, source, pop } });
  const safety = setTimeout(done, SAFETY_MS * 4);

  return {
    progress: (value) => {
      if (committed || finished || !home) return;
      p.value = 1 - PEEK * Math.min(Math.max(value, 0), 1);
    },
    commit: () => {
      if (committed || finished) return;
      committed = true;
      clearTimeout(safety);
      setTimeout(done, SAFETY_MS);
      pop();
      p.value = withSpring(0, zoom.closeSpring, (ok) => {
        if (ok) runOnJS(done)();
      });
      // Land on the row where it is now (Fabric measures from the layout, so this holds while the
      // home screen re-attaches). One retry before the centre fallback, for a row mid-remount.
      const land = (retry: boolean) =>
        source.measure((rect) => {
          if (finished) return;
          if (!rect) {
            if (retry) setTimeout(() => land(false), RETRY_MS);
            else centre.value = withTiming(1, { duration: 120 });
            return;
          }
          const moved =
            Math.abs(rect.x - source.rect.x) > 2 ||
            Math.abs(rect.y - source.rect.y) > 2 ||
            Math.abs(rect.width - source.rect.width) > 2 ||
            Math.abs(rect.height - source.rect.height) > 2;
          if (!moved) return;
          // The open-time still shows the row where it was; the live screen under it is right.
          homeShown.value = 0;
          target.value = withTiming(rect, { duration: 140 });
        });
      setTimeout(() => land(true), MEASURE_MS);
    },
    cancel: () => {
      if (committed || finished) return;
      finished = true;
      clearTimeout(safety);
      p.value = withSpring(1, CANCEL_SPRING, () => {
        runOnJS(clearCancelled)(key);
      });
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
      const current = useCloseStore.getState().request;
      useCloseStore.setState({ request: null });
      disposeLater(current?.chat);
    };
  }, []);
  return request ? <ZoomCloseOverlay key={request.key} request={request} /> : null;
}

function ZoomCloseOverlay({ request }: { request: CloseRequest }) {
  const { width, height } = useWindowDimensions();
  const surface = useThemeColor("background");
  const { chat, home, source } = request;
  const radius = source.radius;

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
    <View pointerEvents="auto" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
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
        <Animated.View style={[{ width, height }, chatStyle]}>
          <Canvas style={{ width, height }}>
            <Image image={chat} x={0} y={0} width={width} height={height} fit="fill" />
          </Canvas>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: "#000" },
  surface: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
});
