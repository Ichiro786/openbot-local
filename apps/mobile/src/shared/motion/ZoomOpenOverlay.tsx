import { BlurView } from "expo-blur";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
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
import { useColorOSRoot } from "./ColorOSMotionRoot";
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

/**
 * Opens a bot or chat with the ColorOS 17 zoom: a surface grows out of the source rect to the full
 * screen on a 380/37 spring while the content behind blurs (10–12 dp), scales to 0.945 and dims 50%.
 * The route is pushed once the surface covers 90%, then the surface fades off the new screen.
 * Returns false when no host is mounted, so the caller navigates directly.
 */
export function zoomOpen(rect: ZoomRect, navigate: () => void, radius = 16): boolean {
  if (!hostMounted) return false;
  useZoomStore.setState({ request: { key: nextKey++, rect, radius, navigate } });
  return true;
}

let hostMounted = false;

/** One host, a sibling after the navigator inside `ColorOSMotionRoot`. */
export function ZoomOpenHost() {
  const request = useZoomStore((s) => s.request);
  useEffect(() => {
    hostMounted = true;
    return () => {
      hostMounted = false;
    };
  }, []);
  return request ? <ZoomOpenOverlay key={request.key} request={request} /> : null;
}

function ZoomOpenOverlay({ request }: { request: ZoomRequest }) {
  const root = useColorOSRoot();
  const { width, height } = useWindowDimensions();
  const surface = useThemeColor("background");
  const p = useSharedValue(0);
  const cover = useSharedValue(1);
  const navigated = useSharedValue(false);
  const { rect, radius, navigate } = request;

  useEffect(() => {
    p.value = withSpring(1, zoom.openSpring);
  }, [p]);

  const finish = () => {
    navigate();
    // The new screen mounts under the surface; hold it a frame or two, then fade off.
    cover.value = withTiming(0, { duration: 220 }, (done) => {
      if (done) runOnJS(clear)();
    });
    if (root) root.backgroundScale.value = 1;
  };

  useAnimatedReaction(
    () => p.value,
    (value) => {
      if (root) root.backgroundScale.value = interpolate(value, [0, 1], [1, zoom.backgroundScale]);
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
  const backdrop = useAnimatedStyle(() => ({ opacity: Math.min(p.value, 1) * cover.value }));
  const dim = useAnimatedStyle(() => ({ opacity: zoom.backgroundDim * Math.min(p.value, 1) * cover.value }));

  return (
    <View pointerEvents="auto" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, backdrop]}>
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={zoom.backgroundBlurIntensity}
          tint="dark"
          blurTarget={root?.blurTarget}
          blurMethod={root?.blurTarget ? "dimezisBlurViewSdk31Plus" : "none"}
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.surface, { backgroundColor: String(surface ?? "#000") }, surfaceStyle]}
      />
    </View>
  );
}

function clear() {
  useZoomStore.setState({ request: null });
}

const styles = StyleSheet.create({
  dim: { backgroundColor: "#000" },
  surface: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
});
