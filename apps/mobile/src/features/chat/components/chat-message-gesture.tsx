import { useThemeColor } from "heroui-native/hooks";
import Reply from "lucide-react-native/icons/reply";
import { type PropsWithChildren, useContext, useMemo, useRef, useState } from "react";
import { View, type ViewInstance } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { END_X, MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { ChatSwipeGestureContext, ChatTimeRevealContext, MESSAGE_TIME_WIDTH } from "./chat-swipe-gesture";

const HOLD_MS = 500;
const PRESS_DELAY_MS = 120;
const PRESSED_SCALE = 0.96;
const PRESS_IN = {
  duration: HOLD_MS - PRESS_DELAY_MS,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};
// Build 10: TalkBack's touch and hold opens the message menu too.
const HOLD_ACTIONS = [{ name: "longpress" as const }];
const RELEASE = { stiffness: 600, damping: 36, mass: 1, reduceMotion: ReduceMotion.System };
const SETTLE = { stiffness: 520, damping: 36, mass: 1, reduceMotion: ReduceMotion.System };
const REPLY_THRESHOLD = 64;
const REPLY_RESET_THRESHOLD = 56;
const TIMES_SETTLE = { duration: 450, dampingRatio: 0.78, reduceMotion: ReduceMotion.System };
const TIMES_OVERSCROLL = 0.4;
const REPLY_OVERSCROLL = 0.15;

function resisted(distance: number, limit: number, part: number): number {
  "worklet";
  return Math.max(0, Math.min(distance, limit) + Math.max(0, distance - limit) * part);
}

export function ChatMessageGesture({
  children,
  align = "start",
  selecting,
  onReply,
  onSelectText,
  onHold,
}: PropsWithChildren<{
  align?: "start" | "end";
  selecting: boolean;
  onReply?: () => void;
  onSelectText?: () => void;
  onHold?: (x: number, y: number) => void;
}>) {
  const muted = useThemeColor("muted");
  const bubble = useRef<ViewInstance | null>(null);
  const offset = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const thresholdCrossed = useSharedValue(false);
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() * END_X }, { scale: pressScale.get() }],
  }));
  const iconStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, offset.get() / REPLY_THRESHOLD);
    const crossed = thresholdCrossed.get();
    return {
      opacity: progress,
      transform: [{ translateX: (progress - 1) * 10 * END_X }, { scale: crossed ? 1.12 : 0.65 + 0.35 * progress }],
    };
  });
  const [iconShown, setIconShown] = useState(false);
  const handlers = useRef({ onReply, onSelectText, onHold });
  handlers.current = { onReply, onSelectText, onHold };
  const canReply = Boolean(onReply) && !selecting;
  const canHold = (Boolean(onHold) || Boolean(onSelectText)) && !selecting;
  const listSwipe = useContext(ChatSwipeGestureContext);
  const timeReveal = useContext(ChatTimeRevealContext);
  const canRevealTime = timeReveal !== null && !selecting;
  const gesture = useMemo(() => {
    const reply = () => {
      void haptics.impact();
      handlers.current.onReply?.();
    };
    const tickThreshold = () => {
      void haptics.impact("light");
    };
    const hold = (x: number, y: number) => {
      void haptics.longPress();
      const { onHold: open, onSelectText: select } = handlers.current;
      if (open) open(x, y);
      else select?.();
    };
    const swipe = Gesture.Pan()
      .enabled(canReply)
      .activeOffsetX(16 * END_X)
      .failOffsetX(-8 * END_X)
      .failOffsetY([-12, 12])
      .onStart(() => {
        thresholdCrossed.set(false);
        scheduleOnRN(setIconShown, true);
      })
      .onUpdate((event) => {
        const raw = event.translationX * END_X;
        offset.set(resisted(raw, REPLY_THRESHOLD, REPLY_OVERSCROLL));
        if (!thresholdCrossed.get() && raw >= REPLY_THRESHOLD) {
          thresholdCrossed.set(true);
          scheduleOnRN(tickThreshold);
        } else if (thresholdCrossed.get() && raw < REPLY_RESET_THRESHOLD) {
          thresholdCrossed.set(false);
        }
      })
      .onEnd((event) => {
        const distance = event.translationX * END_X;
        if (distance >= REPLY_THRESHOLD || (distance >= 24 && event.velocityX * END_X >= 650)) scheduleOnRN(reply);
      })
      .onFinalize(() => {
        thresholdCrossed.set(false);
        offset.set(withSpring(0, SETTLE));
      });
    const times = Gesture.Pan()
      .enabled(canRevealTime)
      .activeOffsetX(-16 * END_X)
      .failOffsetX(8 * END_X)
      .failOffsetY([-12, 12])
      .onStart(() => {
        if (timeReveal) scheduleOnRN(timeReveal.mount);
      })
      .onUpdate((event) => {
        timeReveal?.offset.set(resisted(-event.translationX * END_X, MESSAGE_TIME_WIDTH, TIMES_OVERSCROLL));
      })
      .onFinalize(() => {
        timeReveal?.offset.set(withSpring(0, TIMES_SETTLE));
      });
    if (listSwipe) {
      swipe.blocksExternalGesture(listSwipe);
      times.blocksExternalGesture(listSwipe);
    }
    const press = Gesture.LongPress()
      .enabled(canHold)
      .minDuration(HOLD_MS)
      .onBegin(() => {
        pressScale.set(withDelay(PRESS_DELAY_MS, withTiming(PRESSED_SCALE, PRESS_IN)));
      })
      .onStart((event) => {
        pressScale.set(withSpring(1, RELEASE));
        scheduleOnRN(hold, event.absoluteX, event.absoluteY);
      })
      .onFinalize(() => {
        pressScale.set(withSpring(1, RELEASE));
      });
    return Gesture.Race(swipe, times, press);
  }, [canReply, canHold, canRevealTime, offset, pressScale, thresholdCrossed, listSwipe, timeReveal]);

  return (
    <View className={align === "end" ? "max-w-full self-end" : "max-w-[92%] self-start"}>
      {iconShown ? (
        <Animated.View pointerEvents="none" className="absolute bottom-0 top-0 left-0 justify-center" style={iconStyle}>
          <Reply color={muted} size={22} style={MIRROR_IN_RTL} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View
          ref={bubble}
          style={bubbleStyle}
          // Build 10: TalkBack's touch and hold opens the message menu too, at the bubble's middle.
          accessibilityActions={onHold ? HOLD_ACTIONS : undefined}
          onAccessibilityAction={
            onHold
              ? (event) => {
                  if (event.nativeEvent.actionName !== "longpress") return;
                  bubble.current?.measureInWindow((x, y, width, height) => {
                    if ([x, y, width, height].every(Number.isFinite))
                      handlers.current.onHold?.(x + width / 2, y + height / 2);
                  });
                }
              : undefined
          }
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
