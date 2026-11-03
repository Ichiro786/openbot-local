import { createContext, type PropsWithChildren, type RefObject, useContext } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";

type ColorOSRoot = {
  /**
   * Always undefined. Build 7 wrapped the whole navigator in one app-wide `BlurTargetView` and a
   * scale layer for the zoom-open background. On Android that made every BlurView inside the app
   * blur its own ancestor (black panels), and the zoom left the navigator stuck at 0.945 scale
   * (a black frame round every screen). Blurs now use local sibling targets only.
   */
  blurTarget: RefObject<ViewInstance | null> | undefined;
};

const ROOT: ColorOSRoot = { blurTarget: undefined };
const ColorOSRootContext = createContext<ColorOSRoot | null>(null);

/** Kept for callers: there is no shared blur target any more, so this is always undefined. */
export function useColorOSBlurTarget(): RefObject<ViewInstance | null> | undefined {
  return useContext(ColorOSRootContext)?.blurTarget;
}

export function useColorOSRoot(): ColorOSRoot | null {
  return useContext(ColorOSRootContext);
}

/**
 * Wraps the navigator once and mounts the overlay (the zoom-open host) as a sibling after it.
 * It never transforms or blur-targets the navigator, so screens always draw full size.
 */
export function ColorOSMotionRoot({ children, overlay }: PropsWithChildren<{ overlay?: React.ReactNode }>) {
  return (
    <ColorOSRootContext.Provider value={ROOT}>
      <View style={styles.fill}>
        {children}
        {overlay}
      </View>
    </ColorOSRootContext.Provider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
