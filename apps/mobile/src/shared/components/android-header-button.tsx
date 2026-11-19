import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { View, type ViewStyle } from "react-native";
import { AnimatedPressable } from "@/shared/components/animated-pressable";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { GlassButton, GlassHeaderRoom } from "@/shared/glass/GlassButton";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";

const ICON_RIPPLE = { borderless: true, radius: 20 } as const;
const TEXT_RIPPLE = { borderless: false } as const;

export function AndroidHeaderButton({
  placement,
  icon: Icon,
  text,
  accessibilityLabel,
  hidden = false,
  disabled = false,
  glass: hasGlass = false,
  onPress,
}: {
  placement: "left" | "right";
  accessibilityLabel: string;
  glass?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  onPress: () => void;
} & ({ icon: LucideIcon; text?: undefined } | { icon?: undefined; text: string })) {
  const foreground = String(useThemeColor("foreground"));
  const glass = useChromeGlass();
  const { enabled: colorOS } = useColorOSMotion();
  const press = useRef(onPress);
  useLayoutEffect(() => {
    press.current = onPress;
  });
  const options = useMemo(() => {
    const button = hidden
      ? undefined
      : colorOS && Icon && hasGlass
        ? () => (
            <GlassHeaderRoom>
              <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
                <GlassButton
                  accessibilityLabel={accessibilityLabel}
                  disabled={disabled}
                  style={{ opacity: disabled ? 0.38 : 1 }}
                  onPress={() => press.current()}
                >
                  <Icon color={foreground} size={22} strokeWidth={2} />
                </GlassButton>
              </View>
            </GlassHeaderRoom>
          )
        : () => (
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityState={{ disabled }}
              disabled={disabled}
              android_ripple={text ? TEXT_RIPPLE : ICON_RIPPLE}
              className={`${text ? "h-10 overflow-hidden px-3" : "size-12"} items-center justify-center rounded-full`}
              style={{ opacity: disabled ? 0.38 : 1 }}
              onPress={() => press.current()}
            >
              {Icon ? (
                <GlassCircle glass={hasGlass ? glass : undefined}>
                  <Icon color={foreground} size={22} strokeWidth={2} />
                </GlassCircle>
              ) : (
                <Typography.Paragraph weight="medium" style={{ color: foreground }}>
                  {text}
                </Typography.Paragraph>
              )}
            </AnimatedPressable>
          );
    return placement === "left" ? { headerLeft: button } : { headerRight: button };
  }, [Icon, accessibilityLabel, colorOS, disabled, foreground, glass, hasGlass, hidden, placement, text]);
  return <Stack.Screen options={options} />;
}

export function AndroidStackBackButton({ glass: hasGlass, onPress }: { glass: boolean; onPress: () => void }) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  const glass = useChromeGlass();
  const colorOS = useColorOSMotion().enabled;
  if (colorOS && hasGlass) {
    return (
      <GlassHeaderRoom>
        <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
          <GlassButton
            accessibilityLabel={t("common.back")}
            // GlassButton gives the one press-in tick (review R2-2).
            onPress={onPress}
          >
            <ArrowLeft color={String(foreground)} size={22} strokeWidth={2} />
          </GlassButton>
        </View>
      </GlassHeaderRoom>
    );
  }
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      android_ripple={ICON_RIPPLE}
      className="size-12 items-center justify-center rounded-full"
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <GlassCircle glass={hasGlass ? glass : undefined}>
        <ArrowLeft color={String(foreground)} size={22} strokeWidth={2} style={MIRROR_IN_RTL} />
      </GlassCircle>
    </AnimatedPressable>
  );
}

export function androidBackOptions(
  {
    navigation,
    route,
  }: {
    navigation: { getState(): { routes: readonly { key: string }[] }; goBack(): void };
    route: { key?: string };
  },
  { glass = false }: { glass?: boolean } = {},
) {
  if (!isAndroid || navigation.getState().routes[0]?.key === route.key) return null;
  return { headerLeft: () => <AndroidStackBackButton glass={glass} onPress={() => navigation.goBack()} /> };
}

function GlassCircle({ glass, children }: { glass?: ViewStyle; children: ReactNode }) {
  return (
    <View className="size-10 items-center justify-center overflow-hidden rounded-full" style={glass}>
      {glass ? <ChromeGlassSheen /> : null}
      {children}
    </View>
  );
}
