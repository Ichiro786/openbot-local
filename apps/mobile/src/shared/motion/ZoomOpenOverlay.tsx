import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { COLOROS_CHAT_HEADER_GEOMETRY } from "@/features/chat/components/chat-header-coloros";
import { glass } from "@/shared/glass/tokens";
import { COMPOSER_BAR_INSET, composerBottomGap, restingComposerHeight } from "@/shared/lib/composer-metrics";
import { zoomSkeletonFor } from "./zoomSkeleton";
import { zoom } from "./tokens";
import { armZoomPush, disarmZoomPush, type ZoomSource } from "./zoomPush";

export type ZoomRect = { x: number; y: number; width: number; height: number };

type ZoomRequest = {
  key: number;
  rect: ZoomRect;
  radius: number;
  navigate: () => void;
  /** Build 11.2: handed to the pushed route, so its close can zoom back into the row. */
  source: ZoomSource | null;
};

const useZoomStore = create<{ request: ZoomRequest | null }>(() => ({ request: null }));
let nextKey = 1;
let hostMounted = false;
/** The latest the push runs, whatever happens to the spring. */
const SAFETY_MS = 1200;
/**
 * The longest the surface waits after the push for the chat's ready signal (`markZoomContentReady`)
 * before it dissolves anyway (build 11: 600 ms, spec §3; was 1.5 s on transitionEnd).
 */
const SHOWN_SAFETY_MS = 600;
/** Build 11: one dissolve of the surface (and its skeleton) off the painted chat. */
const DISSOLVE_MS = 160;
const DISSOLVE_EASING = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Opens a bot or chat with the ColorOS zoom: a surface grows out of the source rect to the full
 * screen on a spring while the screen behind dims. The route is pushed once the surface covers 90%,
 * and the surface fades off the new screen once that screen has appeared (at most SHOWN_SAFETY_MS).
 * Nothing behind is scaled or blurred, so no screen can be left shrunk. Returns false when no host
 * is mounted, so the caller navigates directly.
 */
export function zoomOpen(
  rect: ZoomRect,
  navigate: () => void,
  radius = 16,
  source: Omit<ZoomSource, "rect" | "radius"> | null = null,
): boolean {
  if (!hostMounted) return false;
  // Re-entrant taps: one zoom at a time. The second tap navigates directly, as before build 7.
  if (useZoomStore.getState().request) return false;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false;
  useZoomStore.setState({
    request: { key: nextKey++, rect, radius, navigate, source: source && { ...source, rect, radius } },
  });
  return true;
}

/** Build 11: a zoom-open surface is up (a screen mounting now mounts under it). */
export function zoomCovering(): boolean {
  return useZoomStore.getState().request !== null;
}

function clear() {
  disarmZoomPush();
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
  const { rect, radius, navigate, source } = request;

  const uncovered = useRef(false);
  const shownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fade the surface off the new screen once it is on screen (review R12-1: fading on push showed the
  // screen behind while a slow chat was still being built).
  const uncover = () => {
    if (uncovered.current) return;
    uncovered.current = true;
    if (shownTimer.current) clearTimeout(shownTimer.current);
    // Clear whether or not the fade completes (an interrupted animation reports finished=false).
    cover.value = withTiming(0, { duration: DISSOLVE_MS, easing: DISSOLVE_EASING }, () => {
      runOnJS(clear)();
    });
  };

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setPassThrough(true);
    shownTimer.current = setTimeout(uncover, SHOWN_SAFETY_MS);
    // Build 10: the pushed chat takes no native slide under the surface (one open animation).
    // Build 11: `uncover` runs when the chat marks itself painted, or SHOWN_SAFETY_MS after the push.
    armZoomPush(uncover, source);
    navigate();
  };

  // Mount-only: the overlay is keyed per request, and finish reads refs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    p.value = withSpring(1, zoom.openSpring);
    const safety = setTimeout(() => {
      if (!done.current) finish();
    }, SAFETY_MS);
    return () => {
      clearTimeout(safety);
      if (shownTimer.current) clearTimeout(shownTimer.current);
    };
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
  // Build 11: the chat's silhouette fades in on the surface, so the hold before the chat is ready
  // already looks like the chat instead of a flat colour (spec §3 target).
  const skeletonStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.45, 0.9], [0, 1], "clamp"),
    // Held at its screen place while the surface grows around it.
    transform: [
      { translateX: -interpolate(p.value, [0, 1], [rect.x, 0]) },
      { translateY: -interpolate(p.value, [0, 1], [rect.y, 0]) },
    ],
  }));

  return (
    <View pointerEvents={passThrough ? "none" : "auto"} style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.surface, { backgroundColor: String(surface ?? "#000") }, surfaceStyle]}
      >
        <Animated.View style={[{ width, height }, skeletonStyle]}>
          <ChatZoomSkeleton skeletonKey={source?.skeletonKey} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Before a chat has been opened once this session: a pill for a short name, a typical capsule. */
const DEFAULT_PILL_WIDTH = 120;
const DEFAULT_COMPOSER_WIDTH = 240;

/**
 * The chat's shapes at their final places: the hotfix 11.1 ColorOS header (round Back, the 52 dp
 * avatar over the compact 32 dp name pill, the ••• pill, all centred on the 80 dp group) and the
 * composer capsule at rest. Build 11.2: positions come from the header's and composer's own layout
 * constants (COLOROS_CHAT_HEADER_GEOMETRY, composer-metrics), and the pill and capsule widths and the
 * avatar colour from what this chat measured the last time it showed (zoomSkeleton), so the skeleton
 * lands on the real shapes. Plain Views in the solid glass fill: no data, no blur.
 */
function ChatZoomSkeleton({ skeletonKey }: { skeletonKey?: string }) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const fill = useColorScheme() === "light" ? "rgba(0, 0, 0, 0.06)" : glass.material.button.solidDark;
  const g = COLOROS_CHAT_HEADER_GEOMETRY;
  const record = zoomSkeletonFor(skeletonKey);
  const top = insets.top;
  const inner = width - insets.left - insets.right;
  const centreX = insets.left + inner / 2;
  const pillWidth = Math.min(g.pillMaxWidth, Math.max(g.pillMinWidth, record.pillWidth ?? DEFAULT_PILL_WIDTH));
  const cardWidth = inner - 2 * COMPOSER_BAR_INSET;
  const composerWidth = Math.min(cardWidth, record.composerWidth ?? DEFAULT_COMPOSER_WIDTH);
  const composerHeight = record.composerHeight ?? restingComposerHeight(fontScale);
  return (
    <>
      <View
        style={[
          styles.abs,
          {
            left: insets.left + g.back.left,
            top: top + g.back.top,
            width: g.back.size,
            height: g.back.size,
            borderRadius: g.back.size / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            right: insets.right + g.more.right,
            top: top + g.more.top,
            width: g.more.width,
            height: g.more.height,
            borderRadius: g.more.height / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: centreX - pillWidth / 2,
            top: top + g.rowTop + g.avatar - g.overlap,
            width: pillWidth,
            height: g.pillHeight,
            borderRadius: g.pillHeight / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: centreX - g.avatar / 2,
            top: top + g.rowTop,
            width: g.avatar,
            height: g.avatar,
            borderRadius: g.avatar / 2,
            backgroundColor: record.avatarColor ?? fill,
            opacity: record.avatarColor ? 0.55 : 1,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: insets.left + COMPOSER_BAR_INSET + (cardWidth - composerWidth) / 2,
            bottom: composerBottomGap(insets.bottom),
            width: composerWidth,
            height: composerHeight,
            borderRadius: composerHeight / 2,
            backgroundColor: fill,
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  dim: { backgroundColor: "#000" },
  surface: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
});
