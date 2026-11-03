import { BlurTargetView } from "expo-blur";
import { createContext, type PropsWithChildren, type RefObject, useContext, useRef, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { isAndroid } from "@/shared/lib/platform";
import { colorOSMotionEnabled } from "./useColorOSMotion";

type ColorOSRoot = {
  /** The one shared blur target: the app content that menus and the zoom overlay blur. Android only. */
  blurTarget: RefObject<ViewInstance | null> | undefined;
  /** 0 → 1 while the zoom overlay opens: the content behind scales to `zoom.backgroundScale`. */
  backgroundScale: SharedValue<number>;
};

const ColorOSRootContext = createContext<ColorOSRoot | null>(null);

/** The shared blur target, or undefined (iOS, the setting off at launch, or outside the root). */
export function useColorOSBlurTarget(): RefObject<ViewInstance | null> | undefined {
  return useContext(ColorOSRootContext)?.blurTarget;
}

export function useColorOSRoot(): ColorOSRoot | null {
  return useContext(ColorOSRootContext);
}

/**
 * Wraps the navigator once. With ColorOS motion on at launch it adds the single `BlurTargetView`
 * that every ColorOS blur (GlassMenu, ZoomOpenOverlay, edges) reads from, and a scale layer for the
 * zoom-open background. The structure is chosen at mount, so toggling the setting never remounts
 * the navigator (the blur target follows the setting from the next launch). Layout is unchanged:
 * both layers are plain flex-1 views.
 */
export function ColorOSMotionRoot({ children, overlay }: PropsWithChildren<{ overlay?: React.ReactNode }>) {
  const [withTarget] = useState(() => isAndroid && colorOSMotionEnabled());
  const target = useRef<ViewInstance>(null);
  const backgroundScale = useSharedValue(1);
  const [value] = useState<ColorOSRoot>(() => ({
    blurTarget: withTarget ? target : undefined,
    backgroundScale,
  }));
  const scaled = useAnimatedStyle(() =>
    backgroundScale.value === 1 ? { transform: [] } : { transform: [{ scale: backgroundScale.value }] },
  );
  const content = <Animated.View style={[styles.fill, scaled]}>{children}</Animated.View>;
  return (
    <ColorOSRootContext.Provider value={value}>
      <View style={styles.fill}>
        {withTarget ? (
          <BlurTargetView ref={target} style={styles.fill}>
            {content}
          </BlurTargetView>
        ) : (
          content
        )}
        {overlay}
      </View>
    </ColorOSRootContext.Provider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
