import { Button as HeroButton } from "heroui-native";
import type { ComponentProps } from "react";
import { EASE_OUT, PRESSED_SCALE } from "@/shared/lib/motion-tokens";

type ButtonProps = ComponentProps<typeof HeroButton>;

/**
 * HeroUI's press scale defaults to a 300 ms ease and scales by the button's width, so a small icon
 * button sank a long way, slowly, and a wide one barely moved. Every button here sinks to the same
 * 0.97 on a 110 ms strong ease-out instead, so the press lands under the finger at once. The global
 * HeroUI animation switch, which follows Settings > Animations and Reduce Motion, still turns it off.
 */
const PRESS_ANIMATION = {
  scale: {
    value: PRESSED_SCALE,
    timingConfig: { duration: 110, easing: EASE_OUT },
    ignoreScaleCoefficient: true,
  },
} as const satisfies ButtonProps["animation"];

function ButtonRoot(props: ButtonProps) {
  // The props are a union keyed by `feedbackVariant`; one without feedback takes no scale config.
  const pressed = props.animation === undefined && props.feedbackVariant !== "none";
  return <HeroButton {...((pressed ? { ...props, animation: PRESS_ANIMATION } : props) as ButtonProps)} />;
}

/** HeroUI `Button` with the app's press motion. Drop-in: the same props, `Button.Label` and `Button.Background`. */
export const Button = Object.assign(ButtonRoot, {
  Label: HeroButton.Label,
  Background: HeroButton.Background,
});
