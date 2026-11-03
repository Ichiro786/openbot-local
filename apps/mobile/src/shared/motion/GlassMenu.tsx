import { BlurView } from "expo-blur";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
  type ViewInstance,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { create } from "zustand";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { currentFrostTarget } from "./frostTarget";
import { menu } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

export type GlassMenuItem = {
  id: string;
  title: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
};

export type GlassMenuAnchor = { x: number; y: number; width: number; height: number };

type GlassMenuRequest = {
  key: number;
  /** The anchor in window coordinates (`measureInWindow`), or null to open in the middle. */
  anchor: GlassMenuAnchor | null;
  title?: string;
  items: GlassMenuItem[];
  /** Runs once, after the menu has closed and unmounted. */
  onSelect: (id: string) => void;
  /** Runs once when the menu is gone, chosen or not. */
  onClose: () => void;
};

const WIDTH = 224;
const PADDING = 8;
const SEPARATOR = 9;
const TITLE_HEIGHT = 30;
const EDGE = 12;
/** Frost: a 32 dp-ish blur of the target under a lighter tint than the solid card. */
const FROST_INTENSITY = 32;
const FROST_TINT_TOP = 0.56;
const FROST_TINT_BOTTOM = 0.8;
/** The longest a closing menu may stay mounted, whatever happens to its animation callback. */
const CLOSE_SAFETY_MS = 400;

function once<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let called = false;
  return (...args: A) => {
    if (called) return;
    called = true;
    fn(...args);
  };
}

const useGlassMenuStore = create<{ request: GlassMenuRequest | null }>(() => ({ request: null }));
let nextKey = 1;
let hostMounted = false;
/** Keys of menus whose opener unmounted. */
const cancelled = new Set<number>();

/**
 * Opens the ColorOS glass menu in the app window (no RN Modal, no second window, nothing rendered in
 * the header). Returns the request key, or null when no host is mounted so the caller keeps its own
 * menu. A menu that is already open is replaced; its onClose runs first.
 */
export function openGlassMenu(request: Omit<GlassMenuRequest, "key">): number | null {
  if (!hostMounted) return null;
  const previous = useGlassMenuStore.getState().request;
  const key = nextKey++;
  // Each callback runs at most once, whichever path (choice, back, outside tap, replace, unmount) ends it.
  useGlassMenuStore.setState({
    request: { ...request, key, onClose: once(request.onClose), onSelect: once(request.onSelect) },
  });
  previous?.onClose();
  return key;
}

/** Closes the menu with this key at once, without an action (its opener unmounted). */
export function closeGlassMenu(key: number): void {
  // Its opener is gone: an action that was chosen but has not run yet must not run either.
  cancelled.add(key);
  const request = useGlassMenuStore.getState().request;
  if (request?.key !== key) return;
  useGlassMenuStore.setState({ request: null });
  request.onClose();
}

/**
 * One host, a sibling after the navigator inside `ColorOSMotionRoot`, so the menu draws over every
 * screen, header and sheet of the app window and can frost a target inside the navigator.
 */
export function GlassMenuHost() {
  const request = useGlassMenuStore((s) => s.request);
  const host = useRef<ViewInstance>(null);
  // The host's own place in the window, so window-coordinate anchors map into it.
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    hostMounted = true;
    return () => {
      hostMounted = false;
      const open = useGlassMenuStore.getState().request;
      useGlassMenuStore.setState({ request: null });
      open?.onClose();
    };
  }, []);
  const onLayout = (_event: LayoutChangeEvent) => {
    host.current?.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) setBox({ x, y, width, height });
    });
  };
  return (
    <View ref={host} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {request && box ? <GlassMenuOverlay key={request.key} request={request} box={box} /> : null}
    </View>
  );
}

type Row = { top: number; index: number };

/** Lays the rows out once, so a finger y maps to a row without measuring. */
function layout(items: GlassMenuItem[], hasTitle: boolean) {
  const rows: Row[] = [];
  let y = PADDING + (hasTitle ? TITLE_HEIGHT : 0);
  items.forEach((item, index) => {
    if (item.separatorBefore && index > 0) y += SEPARATOR;
    rows.push({ top: y, index });
    y += menu.rowPitch;
  });
  return { rows, height: y + PADDING };
}

/**
 * The ColorOS 17 popup menu. It grows out of its anchor from 0.25 on a critically damped 1450/76
 * spring and is a 27 dp card: frosted (blur of the focused screen's target under a 0.56 → 0.80 tint)
 * where a target is registered, else the solid 0.70 → 0.92 tinted card of build 8. A highlight follows
 * the finger on a 700/50 spring with a selection tick per row change; the card leans ~7 dp toward the
 * finger and stretches up to 1.5%. Touch is the React Native responder of one layer over the card:
 * the JS thread decides the row, the UI thread only animates. Back and an outside tap close it. The
 * chosen action runs after the menu has unmounted, one action per open.
 */
function GlassMenuOverlay({
  request,
  box,
}: {
  request: GlassMenuRequest;
  box: { x: number; y: number; width: number; height: number };
}) {
  const { title, items } = request;
  const { reduceMotion } = useColorOSMotion();
  const { t } = useText();
  const dark = useUniwind().theme === "dark";
  const safe = useSafeAreaInsets();
  const gradientId = `glass-menu-${useId().replaceAll(":", "")}`;
  const { rows, height: naturalHeight } = useMemo(() => layout(items, Boolean(title)), [items, title]);
  // Read once per open: the focused screen's target, only where Android draws the blur.
  const [frost] = useState<RefObject<ViewInstance | null> | null>(() => (ANDROID_BLUR ? currentFrostTarget() : null));

  // Placement in host coordinates: below the anchor when it fits, else above; kept on screen.
  const frame = useMemo(() => {
    const a = request.anchor
      ? { ...request.anchor, x: request.anchor.x - box.x, y: request.anchor.y - box.y }
      : { x: box.width / 2, y: box.height / 2, width: 0, height: 0 };
    const below = box.height - safe.bottom - EDGE - (a.y + a.height + menu.anchorGap);
    const above = a.y - safe.top - EDGE - menu.anchorGap;
    const placeBelow = below >= naturalHeight || below >= above;
    const height = Math.max(menu.rowPitch, Math.min(naturalHeight, placeBelow ? below : above));
    const alignRight = a.x + a.width / 2 > box.width / 2;
    const left = Math.max(EDGE, Math.min(box.width - WIDTH - EDGE, alignRight ? a.x + a.width - WIDTH : a.x));
    const top = placeBelow ? a.y + a.height + menu.anchorGap : a.y - menu.anchorGap - height;
    const originX = Math.max(0, Math.min(WIDTH, a.x + a.width / 2 - left));
    const originY = placeBelow ? 0 : height;
    return { left, top, height, originX, originY };
  }, [request.anchor, box, safe.top, safe.bottom, naturalHeight]);

  const open = useSharedValue(reduceMotion ? 1 : menu.fromScale);
  const fade = useSharedValue(0);
  const highlightY = useSharedValue(-1);
  const highlightAlpha = useSharedValue(0);
  const lean = useSharedValue(0);
  const stretchY = useSharedValue(1);
  const active = useRef(-1);
  const closing = useRef(false);
  const done = useRef(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!reduceMotion) open.set(withSpring(1, menu.openSpring));
    fade.set(withTiming(1, { duration: menu.contentFadeInMs }));
    return () => {
      if (safety.current) clearTimeout(safety.current);
    };
  }, [reduceMotion, open, fade]);

  // Once, from the fade callback or the safety timer: unmount, then run the action a frame later.
  const finish = (id: string | null) => {
    if (done.current) return;
    done.current = true;
    if (safety.current) clearTimeout(safety.current);
    const { onClose, onSelect, key } = request;
    if (useGlassMenuStore.getState().request?.key === key) useGlassMenuStore.setState({ request: null });
    onClose();
    if (id === null) return;
    const wait = Math.max(0, menu.actionDelayMs - menu.closeMs);
    setTimeout(
      () =>
        requestAnimationFrame(() => {
          if (cancelled.delete(key)) return;
          onSelect(id);
        }),
      wait,
    );
  };

  const dismiss = (id: string | null) => {
    if (closing.current) return;
    closing.current = true;
    safety.current = setTimeout(() => finish(id), CLOSE_SAFETY_MS);
    fade.set(
      withTiming(0, { duration: menu.closeMs, easing: Easing.in(Easing.quad) }, () => {
        runOnJS(finish)(id);
      }),
    );
    if (!reduceMotion) open.set(withTiming(menu.closeScale, { duration: menu.closeMs }));
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss(null);
      return true;
    });
    return () => subscription.remove();
  });

  const h = frame.height;
  const rowAt = (y: number) => {
    let index = -1;
    for (const row of rows) {
      if (y >= row.top && y < row.top + menu.rowPitch) index = row.index;
    }
    return index >= 0 && items[index]?.disabled ? -1 : index;
  };

  const track = (y: number, first: boolean) => {
    if (closing.current) return;
    const index = rowAt(y);
    if (index !== active.current) {
      if (index >= 0 && !first) void haptics.selection();
      active.current = index;
    }
    if (index >= 0) {
      const top = rows[index]?.top ?? 0;
      highlightY.set(first || highlightY.get() < 0 ? top : withSpring(top, menu.highlight.spring));
    }
    highlightAlpha.set(withTiming(index >= 0 ? 1 : 0, { duration: first ? 40 : 60 }));
    if (reduceMotion) return;
    lean.set(
      withSpring(Math.max(menu.lean.min, Math.min(menu.lean.max, (y - h / 2) * menu.lean.factor)), menu.lean.spring),
    );
    stretchY.set(withSpring(1 + menu.lean.maxStretch * Math.max(0, Math.min(1, y / h)), menu.lean.spring));
  };

  const settle = () => {
    lean.set(withSpring(0, menu.lean.spring));
    stretchY.set(withSpring(1, menu.lean.spring));
  };

  const release = (event: GestureResponderEvent) => {
    settle();
    const { locationX: x, locationY: y } = event.nativeEvent;
    const index = active.current;
    const inside = x >= 0 && x <= WIDTH && y >= 0 && y <= h;
    const item = index >= 0 ? items[index] : undefined;
    if (inside && item && !item.disabled) {
      dismiss(item.id);
      return;
    }
    highlightAlpha.set(withTiming(0, { duration: 120 }));
    active.current = -1;
  };

  const card = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ translateY: lean.get() }, { scale: open.get() }, { scaleY: stretchY.get() }],
  }));
  const highlight = useAnimatedStyle(() => ({
    opacity: highlightAlpha.get(),
    transform: [{ translateY: highlightY.get() }],
  }));

  const tint = dark ? "22,22,22" : "248,248,248";
  const text = dark ? "#f2f2f2" : "#161616";
  const danger = dark ? "#ff6b6b" : "#d92d20";
  const tintTop = frost ? FROST_TINT_TOP : menu.tintTop;
  const tintBottom = frost ? FROST_TINT_BOTTOM : menu.tintBottom;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable accessibilityLabel={t("common.close")} style={StyleSheet.absoluteFill} onPress={() => dismiss(null)} />
      <Animated.View
        accessibilityRole="menu"
        style={[
          styles.card,
          {
            left: frame.left,
            top: frame.top,
            height: frame.height,
            transformOrigin: [frame.originX, frame.originY, 0],
          },
          card,
        ]}
      >
        {frost ? (
          // Frost: the BlurView lives outside the target (this host is a sibling after the navigator).
          <BlurView
            blurTarget={frost}
            blurMethod="dimezisBlurViewSdk31Plus"
            intensity={FROST_INTENSITY}
            blurReductionFactor={4}
            tint={dark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          // Solid card (build 8) where no target is registered.
          <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgb(${tint})` }]} />
        )}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={`rgb(${tint})`} stopOpacity={tintTop} />
              <Stop offset="1" stopColor={`rgb(${tint})`} stopOpacity={tintBottom} />
            </LinearGradient>
            <LinearGradient id={`${gradientId}-rim`} x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={dark ? 0.16 : 0.5} />
              <Stop offset="1" stopColor="#ffffff" stopOpacity={dark ? 0.04 : 0.12} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
          {frost ? (
            // Specular rim: a hairline, brighter at the top, inside the card's corner radius.
            <Rect
              x={0.5}
              y={0.5}
              width={WIDTH - 1}
              height={Math.max(0, h - 1)}
              rx={menu.radius - 0.5}
              ry={menu.radius - 0.5}
              fill="none"
              stroke={`url(#${gradientId}-rim)`}
              strokeWidth={1}
            />
          ) : null}
        </Svg>
        <Animated.View
          pointerEvents="none"
          style={[styles.highlight, { backgroundColor: dark ? menu.highlight.fill : "rgba(0,0,0,0.07)" }, highlight]}
        />
        {title ? (
          <View pointerEvents="none" style={[styles.title, { top: PADDING }]}>
            <Typography.Paragraph type="body-xs" numberOfLines={1} style={{ color: text, opacity: 0.6 }}>
              {title}
            </Typography.Paragraph>
          </View>
        ) : null}
        {items.map((item, index) => {
          const row = rows[index];
          const color = item.destructive ? danger : text;
          return (
            <View key={item.id} pointerEvents="none">
              {item.separatorBefore && index > 0 && row ? (
                <View
                  style={[
                    styles.separator,
                    { top: row.top - SEPARATOR / 2 - 0.5, backgroundColor: dark ? "#ffffff1f" : "#0000001a" },
                  ]}
                />
              ) : null}
              <View
                accessible
                accessibilityRole="menuitem"
                accessibilityLabel={item.title}
                accessibilityState={{ disabled: item.disabled, selected: item.selected }}
                style={[styles.row, { top: row?.top ?? 0, opacity: item.disabled ? 0.4 : 1 }]}
              >
                {item.icon ? <View style={styles.icon}>{item.icon}</View> : null}
                <Typography.Paragraph weight="medium" numberOfLines={1} style={[styles.label, { color }]}>
                  {item.title}
                </Typography.Paragraph>
                {item.selected ? <Check size={16} color={color} strokeWidth={2.2} /> : null}
              </View>
            </View>
          );
        })}
        {/* One touch layer over the card: its locations are in the card's own (untransformed) space. */}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(event) => track(event.nativeEvent.locationY, true)}
          onResponderMove={(event) => track(event.nativeEvent.locationY, false)}
          onResponderRelease={release}
          onResponderTerminate={() => {
            settle();
            highlightAlpha.set(withTiming(0, { duration: 120 }));
            active.current = -1;
          }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    width: WIDTH,
    borderRadius: menu.radius,
    borderCurve: "continuous",
    overflow: "hidden",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.28)",
  },
  highlight: {
    position: "absolute",
    left: menu.highlight.inset,
    right: menu.highlight.inset,
    top: 0,
    height: menu.rowPitch,
    borderRadius: menu.rowPitch / 2,
  },
  title: { position: "absolute", left: 18, right: 18, height: TITLE_HEIGHT, justifyContent: "center" },
  separator: { position: "absolute", left: 16, right: 16, height: StyleSheet.hairlineWidth },
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    height: menu.rowPitch,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  icon: { width: 18, alignItems: "center" },
  label: { flex: 1, fontSize: 15 },
});
