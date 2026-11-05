import { Canvas, makeImageFromView, Rect, type SkImage, Skia } from "@shopify/react-native-skia";
import {
  createContext,
  createRef,
  type PropsWithChildren,
  type RefObject,
  useContext,
  useEffect,
  useState,
} from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { isAndroid } from "@/shared/lib/platform";
import { windowCapture } from "./predictiveBack";
import { useColorOSMotion } from "./useColorOSMotion";

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
const CAPTURE_SCALE = 0.5;

/** Build 11.2: the navigator's own view (the screens, never the overlays), for the zoom-close snapshots. */
const navigatorView = createRef<ViewInstance>();

/**
 * Build 11.3 council A1: an encoded image is lazy (Skia decodes it the first time it is drawn, which was
 * on the UI thread in the middle of a close: the 32-64 ms hole). Decode it here on the JS thread instead.
 * Without a GPU context on this thread the lazy image is kept (as before).
 */
function decodeNow(image: SkImage): SkImage {
  try {
    const raster = image.makeNonTextureImage();
    if (!raster) return image;
    image.dispose();
    return raster;
  } catch {
    return image;
  }
}

/**
 * Build 11.2: a still image of what the navigator shows now (the top screen, without the overlays).
 * Null when it is not mounted or the capture fails; the caller then closes without the zoom.
 */
export async function snapshotNavigator(): Promise<SkImage | null> {
  if (!navigatorView.current) return null;
  // Build 11.3 motion B3 (audit N01): on Android a half-size PixelCopy off the main thread. Skia's
  // makeImageFromView software-drew the navigator full size on the main thread at the very frames the
  // open and the close start on. The still only stands in for a moving, shrinking screen.
  if (windowCapture) {
    try {
      const jpeg = await windowCapture.captureWindow(CAPTURE_SCALE);
      const image = jpeg ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(jpeg)) : null;
      return image ? decodeNow(image) : null;
    } catch {
      return null;
    }
  }
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
        <SkiaWarmUp />
      </View>
    </ColorOSRootContext.Provider>
  );
}

/**
 * Build 11.3 council D13: the first Skia surface of a session paid the GL context and first-surface
 * cost on the first zoom open/close (one 418 ms frame on the emulator). With ColorOS motion on Android,
 * one tiny canvas draws once a while after start (the app is idle by then) and unmounts again.
 */
const WARM_START_MS = 1500;
const WARM_HOLD_MS = 1000;
function SkiaWarmUp() {
  const { enabled } = useColorOSMotion();
  const [phase, setPhase] = useState<"wait" | "on" | "done">("wait");
  const want = isAndroid && enabled && phase !== "done";
  useEffect(() => {
    if (!want) return;
    const timer = setTimeout(
      () => setPhase(phase === "wait" ? "on" : "done"),
      phase === "wait" ? WARM_START_MS : WARM_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [want, phase]);
  if (!want || phase !== "on") return null;
  return (
    <Canvas pointerEvents="none" style={styles.warm} importantForAccessibility="no-hide-descendants">
      <Rect x={0} y={0} width={2} height={2} color="#000" />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  warm: { position: "absolute", left: 0, top: 0, width: 2, height: 2, opacity: 0.01 },
});
