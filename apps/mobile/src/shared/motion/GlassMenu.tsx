import { BlurView } from "expo-blur";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { BackHandler, Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
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
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useColorOSBlurTarget } from "./ColorOSMotionRoot";
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

const WIDTH = 224;
const PADDING = 8;
const SEPARATOR = 9;
const TITLE_HEIGHT = 30;
const EDGE = 12;

type Row = { top: number; height: number; index: number };

/** Lays the rows out once, so the worklet maps a finger y to a row without measuring. */
function layout(items: GlassMenuItem[], hasTitle: boolean) {
  const rows: Row[] = [];
  let y = PADDING + (hasTitle ? TITLE_HEIGHT : 0);
  items.forEach((item, index) => {
    if (item.separatorBefore && index > 0) y += SEPARATOR;
    rows.push({ top: y, height: menu.rowPitch, index });
    y += menu.rowPitch;
  });
  return { rows, height: y + PADDING };
}

/**
 * The ColorOS 17 popup menu. It grows out of its anchor from 0.25 on a critically damped 1450/76
 * spring, is a 27 dp frosted card (blur of the shared target under a 0.70 → 0.92 tint), and a
 * highlight follows the finger on a 700/50 spring with a selection tick per row change. The card
 * leans ~7 dp toward the finger and stretches up to 1.5% (600/40). Drag-to-select and tap both work.
 * Reduce motion keeps the frost, highlight and haptics and drops the scale, lean and stretch.
 */
export function GlassMenu({
  visible,
  anchor,
  title,
  items,
  onSelect,
  onClose,
}: {
  visible: boolean;
  anchor: GlassMenuAnchor | null;
  title?: string;
  items: GlassMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { reduceMotion } = useColorOSMotion();
  const { t } = useText();
  const target = useColorOSBlurTarget();
  const dark = useUniwind().theme === "dark";
  const window = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const gradientId = `glass-menu-${useId().replaceAll(":", "")}`;
  const { rows, height: naturalHeight } = useMemo(() => layout(items, Boolean(title)), [items, title]);
  const [shown, setShown] = useState(false);

  // Placement: below the anchor when it fits, else above; horizontally kept on screen.
  const frame = useMemo(() => {
    const a = anchor ?? { x: window.width / 2, y: window.height / 2, width: 0, height: 0 };
    const below = window.height - safe.bottom - EDGE - (a.y + a.height + menu.anchorGap);
    const above = a.y - safe.top - EDGE - menu.anchorGap;
    const placeBelow = below >= naturalHeight || below >= above;
    const height = Math.min(naturalHeight, placeBelow ? below : above);
    const alignRight = a.x + a.width / 2 > window.width / 2;
    const left = Math.max(EDGE, Math.min(window.width - WIDTH - EDGE, alignRight ? a.x + a.width - WIDTH : a.x));
    const top = placeBelow ? a.y + a.height + menu.anchorGap : a.y - menu.anchorGap - height;
    // Grow from the anchor's corner.
    const originX = Math.max(0, Math.min(WIDTH, a.x + a.width / 2 - left));
    const originY = placeBelow ? 0 : height;
    return { left, top, height, originX, originY };
  }, [anchor, window.width, window.height, safe.top, safe.bottom, naturalHeight]);

  const open = useSharedValue(0);
  const fade = useSharedValue(0);
  const highlightY = useSharedValue(-1);
  const highlightAlpha = useSharedValue(0);
  const lean = useSharedValue(0);
  const stretchY = useSharedValue(1);
  const active = useSharedValue(-1);

  useEffect(() => {
    if (!visible) return;
    setShown(true);
    open.value = reduceMotion ? 1 : menu.fromScale;
    open.value = reduceMotion ? 1 : withSpring(1, menu.openSpring);
    fade.value = withTiming(1, { duration: menu.contentFadeInMs });
    highlightAlpha.value = 0;
    active.value = -1;
  }, [visible, reduceMotion, open, fade, highlightAlpha, active]);

  useEffect(() => {
    if (!shown) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  });

  const finishClose = (id?: string) => {
    setShown(false);
    onClose();
    if (id) setTimeout(() => onSelect(id), Math.max(0, menu.actionDelayMs - menu.closeMs));
  };

  const dismiss = (id?: string) => {
    fade.value = withTiming(0, { duration: menu.closeMs, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) runOnJS(finishClose)(id);
    });
    if (!reduceMotion) open.value = withTiming(menu.closeScale, { duration: menu.closeMs });
  };

  const tick = () => {
    void haptics.selection();
  };
  const choose = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    dismiss(item.id);
  };

  const rowTops = rows.map((r) => r.top);
  const disabled = items.map((item) => Boolean(item.disabled));
  const h = frame.height;
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      highlightAlpha.value = withTiming(1, { duration: 40 });
      track(e.y, true);
    })
    .onUpdate((e) => {
      track(e.y, false);
    })
    .onFinalize((e) => {
      lean.value = withSpring(0, menu.lean.spring);
      stretchY.value = withSpring(1, menu.lean.spring);
      const inside = e.x >= 0 && e.x <= WIDTH && e.y >= 0 && e.y <= h;
      const index = active.value;
      if (inside && index >= 0) runOnJS(choose)(index);
      else {
        highlightAlpha.value = withTiming(0, { duration: 120 });
        active.value = -1;
      }
    });

  function track(y: number, first: boolean) {
    "worklet";
    let index = -1;
    for (let i = 0; i < rowTops.length; i++) {
      const top = rowTops[i] ?? 0;
      if (y >= top && y < top + menu.rowPitch) index = i;
    }
    if (index >= 0 && disabled[index]) index = -1;
    if (index !== active.value) {
      if (index >= 0 && !first) runOnJS(tick)();
      active.value = index;
    }
    if (index >= 0) {
      const top = rowTops[index] ?? 0;
      highlightY.value = first || highlightY.value < 0 ? top : withSpring(top, menu.highlight.spring);
    }
    highlightAlpha.value = withTiming(index >= 0 ? 1 : 0, { duration: 60 });
    if (reduceMotion) return;
    const offset = y - h / 2;
    lean.value = withSpring(
      Math.max(menu.lean.min, Math.min(menu.lean.max, offset * menu.lean.factor)),
      menu.lean.spring,
    );
    const t = Math.max(0, Math.min(1, y / h));
    stretchY.value = withSpring(1 + menu.lean.maxStretch * t, menu.lean.spring);
  }

  const card = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: lean.value }, { scale: open.value }, { scaleY: stretchY.value }],
  }));
  const highlight = useAnimatedStyle(() => ({
    opacity: highlightAlpha.value,
    transform: [{ translateY: highlightY.value }],
  }));

  const tint = dark ? "22,22,22" : "248,248,248";
  const text = dark ? "#f2f2f2" : "#161616";
  const danger = dark ? "#ff6b6b" : "#d92d20";

  return (
    <Modal transparent visible={visible || shown} animationType="none" statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Pressable accessibilityLabel={t("common.close")} style={StyleSheet.absoluteFill} onPress={() => dismiss()} />
        <GestureDetector gesture={pan}>
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
            <BlurView
              style={StyleSheet.absoluteFill}
              intensity={menu.blurIntensity}
              tint={dark ? "dark" : "light"}
              blurTarget={target}
              blurMethod={target ? "dimezisBlurViewSdk31Plus" : "none"}
            />
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
              <Defs>
                <LinearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <Stop offset="0" stopColor={`rgb(${tint})`} stopOpacity={menu.tintTop} />
                  <Stop offset="1" stopColor={`rgb(${tint})`} stopOpacity={menu.tintBottom} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
            </Svg>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.highlight,
                { backgroundColor: dark ? menu.highlight.fill : "rgba(0,0,0,0.07)" },
                highlight,
              ]}
            />
            {title ? (
              <View style={[styles.title, { top: PADDING }]}>
                <Typography.Paragraph type="body-xs" numberOfLines={1} style={{ color: text, opacity: 0.6 }}>
                  {title}
                </Typography.Paragraph>
              </View>
            ) : null}
            {items.map((item, index) => {
              const row = rows[index];
              const color = item.destructive ? danger : text;
              return (
                <View key={item.id}>
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
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
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
