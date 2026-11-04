import type { AvatarHue } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { AvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import {
  AVATAR_SCALE_MAX,
  AVATAR_SCALE_MIN,
  AVATAR_SCALE_STEP,
  clampAvatarScale,
  saveAvatarScale,
  useAvatarScale,
} from "@/features/settings/model/avatar-size";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const THUMB = 24;
const PREVIEW = 52;

/**
 * Build 11.3 (Syed): Settings › Appearance › Avatar size, 80-130 % in 5 % steps (100 % = a photo's
 * size). The preview follows the finger; every avatar in the app takes the size on release, so a drag
 * bakes at most one plush size per step. TalkBack: adjustable, swipe up/down by one step.
 */
export function AvatarSizeSlider({ seed, hue }: { seed: string; hue: AvatarHue | null }) {
  const { t } = useText();
  const label = t("mobile.settings.appearance.avatarSize");
  const saved = useAvatarScale((state) => state.scale);
  const ready = useAvatarScale((state) => state.ready);
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? saved;
  const width = useRef(0);
  const accent = String(useThemeColor("accent") ?? "#888");
  const track = String(useThemeColor("muted") ?? "#555");
  const fraction = (value - AVATAR_SCALE_MIN) / (AVATAR_SCALE_MAX - AVATAR_SCALE_MIN);
  const fromX = (x: number) =>
    clampAvatarScale(
      AVATAR_SCALE_MIN +
        (Math.max(0, Math.min(width.current, x)) / Math.max(1, width.current)) * (AVATAR_SCALE_MAX - AVATAR_SCALE_MIN),
    );
  const move = (event: GestureResponderEvent) => {
    const next = fromX(event.nativeEvent.locationX);
    setDragging((current) => {
      if (current !== next) void haptics.selection();
      return next;
    });
  };
  const commit = (next: number) => {
    setDragging(null);
    void saveAvatarScale(next).catch(() => undefined);
  };
  const percent = Math.round(value * 100);
  return (
    <View style={styles.row}>
      <View style={styles.preview}>
        <View style={{ transform: [{ scale: value }] }}>
          <AvatarThumbnail seed={seed} hue={hue} size={PREVIEW} />
        </View>
      </View>
      <View style={styles.column}>
        <View style={styles.labels}>
          <Typography.Paragraph>{label}</Typography.Paragraph>
          <Typography.Paragraph style={styles.value}>
            {t("mobile.settings.appearance.avatarSizeValue", { percent })}
          </Typography.Paragraph>
        </View>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{
            min: 80,
            max: 130,
            now: percent,
            text: t("mobile.settings.appearance.avatarSizeValue", { percent }),
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (!ready) return;
            const delta = nativeEvent.actionName === "increment" ? AVATAR_SCALE_STEP : -AVATAR_SCALE_STEP;
            void saveAvatarScale(clampAvatarScale(saved + delta)).catch(() => undefined);
          }}
          style={styles.touch}
          onLayout={(event: LayoutChangeEvent) => {
            width.current = event.nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => ready}
          onMoveShouldSetResponder={() => ready}
          onResponderTerminationRequest={() => false}
          onResponderGrant={move}
          onResponderMove={move}
          onResponderRelease={(event) => commit(fromX(event.nativeEvent.locationX))}
          onResponderTerminate={() => commit(dragging ?? saved)}
        >
          <View pointerEvents="none" style={[styles.track, { backgroundColor: track }]}>
            <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: accent }]} />
          </View>
          <View pointerEvents="none" style={[styles.thumb, { left: `${fraction * 100}%`, backgroundColor: accent }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 8 },
  preview: {
    width: PREVIEW * AVATAR_SCALE_MAX,
    height: PREVIEW * AVATAR_SCALE_MAX,
    alignItems: "center",
    justifyContent: "center",
  },
  column: { flex: 1 },
  labels: { flexDirection: "row", justifyContent: "space-between" },
  value: { opacity: 0.7, fontVariant: ["tabular-nums"] },
  touch: { height: 40, justifyContent: "center", marginHorizontal: THUMB / 2 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4 },
  thumb: { position: "absolute", width: THUMB, height: THUMB, borderRadius: THUMB / 2, marginLeft: -THUMB / 2, top: 8 },
});
