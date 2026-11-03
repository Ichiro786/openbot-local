import { useFocusEffect } from "expo-router";
import { type RefObject, useCallback } from "react";
import type { ViewInstance } from "react-native";
import { create } from "zustand";

/**
 * The content that ColorOS glass menus frost. A screen that already wraps its scrolling content in a
 * `BlurTargetView` (home) registers that target while it has focus; the menu host (a sibling after
 * the navigator, never inside the target) blurs it. A screen without a target leaves it null and the
 * menu draws its solid tinted card. The target is dropped when the screen loses focus, so a menu over
 * another screen or sheet never shows the hidden home list through its glass.
 */
const useFrostTargetStore = create<{ target: RefObject<ViewInstance | null> | null }>(() => ({ target: null }));

export function currentFrostTarget(): RefObject<ViewInstance | null> | null {
  const target = useFrostTargetStore.getState().target;
  return target?.current ? target : null;
}

/** Registers `target` while the screen is focused and `enabled` holds. */
export function useFrostTarget(target: RefObject<ViewInstance | null>, enabled: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      useFrostTargetStore.setState({ target });
      return () => {
        if (useFrostTargetStore.getState().target === target) useFrostTargetStore.setState({ target: null });
      };
    }, [target, enabled]),
  );
}
