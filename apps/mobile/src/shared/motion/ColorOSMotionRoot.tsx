import { makeImageFromView, type SkImage } from "@shopify/react-native-skia";
import { createContext, createRef, type PropsWithChildren, type RefObject, useContext } from "react";
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
/** Build 11.2: the navigator's own view (the screens, never the overlays), for the zoom-close snapshots. */
const navigatorView = createRef<ViewInstance>();

/**
 * Build 11.2: a still image of what the navigator shows now (the top screen, without the overlays).
 * Null when it is not mounted or the capture fails; the caller then closes without the zoom.
 */
export async function snapshotNavigator(): Promise<SkImage | null> {
  if (!navigatorView.current) return null;
  try {
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: Skia types the ref as a class component; it only reads its native tag (findNodeHandle).
    return await makeImageFromView(navigatorView as unknown as RefObject<React.Component<unknown, unknown>>);
  } catch {
    return null;
  }
}

export function ColorOSMotionRoot({ children, overlay }: PropsWithChildren<{ overlay?: React.ReactNode }>) {
  return (
    <ColorOSRootContext.Provider value={ROOT}>
      <View style={styles.fill}>
        <View ref={navigatorView} collapsable={false} style={styles.fill}>
          {children}
        </View>
        {overlay}
      </View>
    </ColorOSRootContext.Provider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
