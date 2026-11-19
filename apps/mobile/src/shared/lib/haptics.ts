import * as ExpoHaptics from "expo-haptics";
import { useHapticsPreference } from "../../features/settings/model/haptics";
import { isAndroid } from "./platform";

async function play(feedback: () => Promise<void>): Promise<void> {
  const { enabled, ready } = useHapticsPreference.getState();
  if (!ready || !enabled) return;
  try {
    await feedback();
  } catch {}
}

type ImpactStyle = "light" | "medium" | "heavy" | "soft" | "rigid";

const A = ExpoHaptics.AndroidHaptics;
const ANDROID_IMPACT: Record<ImpactStyle, ExpoHaptics.AndroidHaptics> = {
  light: A.Context_Click,
  soft: A.Context_Click,
  medium: A.Virtual_Key,
  heavy: A.Long_Press,
  rigid: A.Keyboard_Tap,
};
const ANDROID_NOTIFICATION: Record<"success" | "warning" | "error", ExpoHaptics.AndroidHaptics> = {
  success: A.Confirm,
  warning: A.Reject,
  error: A.Reject,
};

export const haptics = {
  selection: (): Promise<void> =>
    play(() => (isAndroid ? ExpoHaptics.performAndroidHapticsAsync(A.Segment_Tick) : ExpoHaptics.selectionAsync())),
  impact: (style: ImpactStyle = "light"): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(ANDROID_IMPACT[style])
        : ExpoHaptics.impactAsync(
            {
              light: ExpoHaptics.ImpactFeedbackStyle.Light,
              medium: ExpoHaptics.ImpactFeedbackStyle.Medium,
              heavy: ExpoHaptics.ImpactFeedbackStyle.Heavy,
              soft: ExpoHaptics.ImpactFeedbackStyle.Soft,
              rigid: ExpoHaptics.ImpactFeedbackStyle.Rigid,
            }[style],
          ),
    ),
  longPress: (): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(A.Long_Press)
        : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium),
    ),
  /** A message leaves: the key-press click Android plays for its own send buttons. */
  send: (): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(A.Virtual_Key)
        : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light),
    ),
  /** Something the user asked for went through, such as a copy. */
  confirm: (): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(A.Confirm)
        : ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success),
    ),
  /** A stop or a refusal, such as stopping a running turn. */
  reject: (): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(A.Reject)
        : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Rigid),
    ),
  /** A switch or toggle lands on or off. Android plays a different click for each. */
  toggle: (on: boolean): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(on ? A.Toggle_On : A.Toggle_Off)
        : ExpoHaptics.selectionAsync(),
    ),
  /** A drag or swipe passes the point where releasing commits it. */
  gestureThreshold: (): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(A.Gesture_Start)
        : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light),
    ),
  notification: (type: "success" | "warning" | "error" = "success"): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(ANDROID_NOTIFICATION[type])
        : ExpoHaptics.notificationAsync(
            {
              success: ExpoHaptics.NotificationFeedbackType.Success,
              warning: ExpoHaptics.NotificationFeedbackType.Warning,
              error: ExpoHaptics.NotificationFeedbackType.Error,
            }[type],
          ),
    ),
};
