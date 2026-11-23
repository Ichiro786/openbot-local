import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { type ColorValue, Pressable, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { press as colorOSPress } from "@/shared/motion/tokens";
import { ThinkingTextGradient } from "./thinking-text-gradient";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN = Easing.in(Easing.cubic);
const FADE_IN = {
  duration: 220,
  easing: EASE_OUT,
  reduceMotion: ReduceMotion.Never,
};
const MOVE_IN = {
  stiffness: 420,
  damping: 34,
  mass: 1,
  reduceMotion: ReduceMotion.System,
};
const FADE_OUT = {
  duration: 150,
  easing: EASE_IN,
  reduceMotion: ReduceMotion.Never,
};
const MOVE_OUT = {
  duration: 150,
  easing: EASE_IN,
  reduceMotion: ReduceMotion.System,
};
const LABEL_LINES = 2;

function activityEntering() {
  "worklet";
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 10 }, { scale: 0.94 }],
    },
    animations: {
      opacity: withTiming(1, FADE_IN),
      transform: [{ translateY: withSpring(0, MOVE_IN) }, { scale: withSpring(1, MOVE_IN) }],
    },
  };
}

function activityExiting() {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, FADE_OUT),
      transform: [{ translateY: withTiming(-6, MOVE_OUT) }, { scale: withTiming(0.95, MOVE_OUT) }],
    },
  };
}

export interface ChatActivitySpec {
  key: string;
  label: string;
  accessibilityLabel: string;
  agent?: Pick<MobileAgent, "id" | "serverId" | "avatarHue" | "avatarSeed" | "avatarColor">;
  mood: AvatarMood;
  online: boolean;
  animateAvatar: boolean;
  shimmer: boolean;
  onPress?: () => void;
}

export function ChatActivityRow({
  spec,
  foreground,
  muted,
}: {
  spec: ChatActivitySpec;
  foreground: ColorValue;
  muted: ColorValue;
}) {
  const { t } = useText();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  const { onPress } = spec;
  return (
    <Animated.View entering={activityEntering} exiting={activityExiting}>
      <Pressable
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={spec.accessibilityLabel}
        accessibilityHint={onPress ? t("mobile.chat.thinking.openHint") : undefined}
        onPressIn={() => {
          if (onPress && !reducedMotion) scale.set(withSpring(colorOSPress.rowScale, colorOSPress.spring));
        }}
        onPressOut={() => {
          if (onPress && !reducedMotion) scale.set(withSpring(1, colorOSPress.spring));
        }}
        onPress={() => {
          if (!onPress) return;
          void haptics.selection();
          onPress();
        }}
      >
        <Animated.View className="flex-row items-center gap-2 px-1 py-2" style={pressStyle}>
          {spec.agent ? (
            <BloubAvatarPreview
              agentId={spec.agent.id}
              serverId={spec.agent.serverId}
              hue={spec.agent.avatarHue}
              color={spec.agent.avatarColor}
              seed={spec.agent.avatarSeed}
              size={36}
              disconnected={!spec.online}
              mood={spec.mood}
              animateIdle={spec.animateAvatar}
            />
          ) : null}
          <View className="min-w-0 flex-1">
            <ThinkingTextGradient
              text={spec.label}
              numberOfLines={LABEL_LINES}
              foreground={foreground}
              muted={muted}
              enabled={spec.shimmer}
            />
          </View>
          {onPress ? <ChevronRight size={16} color={muted} style={MIRROR_IN_RTL} /> : null}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
