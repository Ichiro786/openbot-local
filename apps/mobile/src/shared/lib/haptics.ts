import * as ExpoHaptics from "expo-haptics";
import { useHapticsPreference } from "../../features/settings/model/haptics";
import { isAndroid } from "./platform";

async function play(feedback: () => Promise<void>): Promise<void> {
  const { enabled, ready } = useHapticsPreference.getState();
  if (!ready || !enabled) return;
  try {
    await feedback();
  } catch {
    // Missing hardware or a native failure must not interrupt the user's action.
  }
}

type ImpactStyle = "light" | "medium" | "heavy" | "soft" | "rigid";

/**
 * Android plays the system haptic constants (View.performHapticFeedback) instead of vibrator
 * patterns: they feel like the system UI, follow the user's system haptics setting and need no
 * VIBRATE permission.
 */
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

/** Shared mobile feedback. From a worklet, call through scheduleOnRN. */
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
  /** The tick when a long press opens a menu, so the user knows the finger can lift. */
  longPress: (): Promise<void> =>
    play(() =>
      isAndroid
        ? ExpoHaptics.performAndroidHapticsAsync(A.Long_Press)
        : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium),
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
