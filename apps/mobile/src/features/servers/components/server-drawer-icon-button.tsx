import { AnimatedPressable } from "@/shared/components/animated-pressable";

import type { ServerDrawerIconButtonProps } from "./server-drawer-icon-button.types";

// OpenBot Local keeps the Android drawer glass of 1.4.10 (upstream #10445 reverted): plain or filled circle.
export function ServerDrawerIconButton({
  accessibilityLabel,
  children,
  fallbackVariant = "plain",
  onPress,
}: ServerDrawerIconButtonProps) {
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={
        fallbackVariant === "filled"
          ? "size-9 items-center justify-center rounded-full bg-control"
          : "size-10 items-center justify-center rounded-full"
      }
      hitSlop={fallbackVariant === "filled" ? 6 : 8}
      onPress={onPress}
      pressOpacity={0.6}
    >
      {children}
    </AnimatedPressable>
  );
}
