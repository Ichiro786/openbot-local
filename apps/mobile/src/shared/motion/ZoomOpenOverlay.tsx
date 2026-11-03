import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { create } from "zustand";
import { zoom } from "./tokens";

export type ZoomRect = { x: number; y: number; width: number; height: number };

type ZoomRequest = {
  key: number;
  rect: ZoomRect;
  radius: number;
  navigate: () => void;
};

const useZoomStore = create<{ request: ZoomRequest | null }>(() => ({ request: null }));
let nextKey = 1;
let hostMounted = false;
/** The longest an overlay may stay up, whatever happens to its animations. */
const SAFETY_MS = 1200;

/**
 * Opens a bot or chat with the ColorOS zoom: a surface grows out of the source rect to the full
 * screen on a spring while the screen behind dims. The route is pushed once the surface covers 90%,
 * then the surface fades off the new screen. Nothing behind is scaled or blurred, so no screen can be
 * left shrunk. Returns false when no host is mounted, so the caller navigates directly.
 */
export function zoomOpen(rect: ZoomRect, navigate: () => void, radius = 16): boolean {
  if (!hostMounted) return false;
  // Re-entrant taps: one zoom at a time. The second tap navigates directly, as before build 7.
  if (useZoomStore.getState().request) return false;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false;
  useZoomStore.setState({ request: { key: nextKey++, rect, radius, navigate } });
  return true;
}

function clear() {
  useZoomStore.setState({ request: null });
}

/** One host, a sibling after the navigator inside `ColorOSMotionRoot`. */
export function ZoomOpenHost() {
  const request = useZoomStore((s) => s.request);
  useEffect(() => {
    hostMounted = true;
    return () => {
      hostMounted = false;
      clear();
    };
  }, []);
  return request ? <ZoomOpenOverlay key={request.key} request={request} /> : null;
}

function ZoomOpenOverlay({ request }: { request: ZoomRequest }) {
  const { width, height } = useWindowDimensions();
  const surface = useThemeColor("background");
  const p = useSharedValue(0);
  const cover = useSharedValue(1);
  const navigated = useSharedValue(false);
  const done = useRef(false);
  // Touches pass through once the route is pushed, so a stuck overlay can never block the app.
  const [passThrough, setPassThrough] = useState(false);
  const { rect, radius, navigate } = request;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setPassThrough(true);
    try {
      navigate();
    } finally {
      // Clear whether or not the fade completes (an interrupted animation reports finished=false).
      cover.value = withTiming(0, { duration: 220 }, () => {
        runOnJS(clear)();
      });
    }
  };

  // Mount-only: the overlay is keyed per request, and finish reads refs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    p.value = withSpring(1, zoom.openSpring);
    const safety = setTimeout(() => {
      if (!done.current) finish();
      clear();
    }, SAFETY_MS);
    return () => clearTimeout(safety);
  }, []);

  useAnimatedReaction(
    () => p.value,
    (value) => {
      if (!navigated.value && value >= zoom.navigateAt) {
        navigated.value = true;
        runOnJS(finish)();
      }
    },
  );

  const surfaceStyle = useAnimatedStyle(() => {
    const v = p.value;
    return {
      left: interpolate(v, [0, 1], [rect.x, 0]),
      top: interpolate(v, [0, 1], [rect.y, 0]),
      width: interpolate(v, [0, 1], [rect.width, width]),
      height: interpolate(v, [0, 1], [rect.height, height]),
      borderRadius: interpolate(v, [0, 1], [radius, zoom.endRadius]),
      opacity: cover.value * interpolate(v, [0, zoom.fillFade[0], zoom.fillFade[1]], [0, 0.6, 1], "clamp"),
    };
  });
  const dim = useAnimatedStyle(() => ({ opacity: zoom.backgroundDim * Math.min(p.value, 1) * cover.value }));

  return (
    <View pointerEvents={passThrough ? "none" : "auto"} style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.surface, { backgroundColor: String(surface ?? "#000") }, surfaceStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: "#000" },
  surface: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
});
