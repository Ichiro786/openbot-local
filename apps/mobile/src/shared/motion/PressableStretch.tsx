import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * Was a gesture-handler Manual gesture round a control that keeps its own Pressable (the floating
 * glass capsules). It competed with the inner Pressable and the scroll views under the composer, so
 * it is now a pass-through: the capsule keeps its own opacity press.
 */
export function StretchShell({ children }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <>{children}</>;
}
