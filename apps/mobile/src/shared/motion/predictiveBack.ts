import { type NativeModule, requireOptionalNativeModule } from "expo";
import { BackHandler } from "react-native";

type Events = {
  onBackStart: (event: { progress: number; edge: number }) => void;
  onBackProgress: (event: { progress: number }) => void;
  onBackCancel: () => void;
  onBackInvoke: () => void;
};

declare class PredictiveBackModule extends NativeModule<Events> {
  hasProgress(): boolean;
  setEnabled(enabled: boolean): boolean;
  /** Build 11.3 motion B3: a JPEG (base64) still of the window at `scale`, copied off the main thread. */
  captureWindow(scale: number): Promise<string | null>;
}

/**
 * Build 11.2 (`modules/predictive-back`): the Android 14+ predictive back progress for the zoom-close.
 * Null on iOS, in Expo Go, and below Android 14, where Back stays React Navigation's.
 */
const native = requireOptionalNativeModule<PredictiveBackModule>("OpenBotPredictiveBack");
export const predictiveBack = native?.hasProgress() ? native : null;
/** Build 11.3 motion B3: the window still (any Android with the module, API 26+), for the zoom stills. */
export const windowCapture = native;

/**
 * Something in the chat takes Back first (the attachment panel, dictation, voice, a live conversation).
 * While any is held, the predictive callback stays off, so the gesture goes to React Native and that
 * listener runs, exactly as before build 11.2.
 */
let holds = 0;
const watchers = new Set<() => void>();

export function chatBackHeld(): boolean {
  return holds > 0;
}

export function watchChatBackHolds(watch: () => void): () => void {
  watchers.add(watch);
  return () => watchers.delete(watch);
}

/** `BackHandler.addEventListener("hardwareBackPress", …)` for a chat listener that takes Back first. */
export function addChatBackListener(handler: () => boolean | undefined): { remove: () => void } {
  const subscription = BackHandler.addEventListener("hardwareBackPress", handler);
  holds += 1;
  for (const watch of watchers) watch();
  let removed = false;
  return {
    remove: () => {
      if (removed) return;
      removed = true;
      subscription.remove();
      holds -= 1;
      for (const watch of watchers) watch();
    },
  };
}

/** Each zoom-opened chat in front holds the native callback on; it is off when none does. */
let enabledHolds = 0;
export function holdPredictiveBack(): () => void {
  enabledHolds += 1;
  if (enabledHolds === 1) predictiveBack?.setEnabled(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    enabledHolds -= 1;
    if (enabledHolds === 0) predictiveBack?.setEnabled(false);
  };
}
