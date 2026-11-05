import { colorOSMotionEnabled } from "@/shared/motion/useColorOSMotion";

// The native return transition shows tappable agent rows before it ends.
// Navigating during that window can lose the first tap when reopening the same chat,
// so retain it until transitionEnd and route focus have both settled (in either order).
/**
 * Build 11.3 council A6: the longest a transition holds a tap. A transitionEnd that never comes (a pop
 * with animation "none", a reversed zoom-open) must not leave every row tap pending.
 */
const TRANSITION_BOUND_MS = 700;

export function createChatNavigationGate() {
  let transitioning = false;
  let bound: ReturnType<typeof setTimeout> | null = null;
  function clearBound() {
    if (bound) clearTimeout(bound);
    bound = null;
  }
  let pending: { navigate: () => void; isFocused: () => boolean } | null = null;

  function flush() {
    if (transitioning || !pending?.isFocused()) return;
    const { navigate } = pending;
    pending = null;
    navigate();
  }

  return {
    request(navigate: () => void, isFocused: () => boolean) {
      // Nested navigators may already be focused without emitting an initial focus
      // event. Tracking focus in a boolean initially set to false blocked every tap
      // on first load. Read isFocused() on each flush; focus events only retry a
      // pending tap when focus arrives after transitionEnd.
      pending = { navigate, isFocused };
      flush();
    },
    start() {
      transitioning = true;
      clearBound();
      // ColorOS motion only (its zoom pops and reversed opens are what can skip a transitionEnd).
      if (!colorOSMotionEnabled()) return;
      bound = setTimeout(() => {
        bound = null;
        transitioning = false;
        flush();
      }, TRANSITION_BOUND_MS);
    },
    finish() {
      clearBound();
      transitioning = false;
      flush();
    },
    focus() {
      flush();
    },
    blur() {
      pending = null;
    },
    cancel() {
      clearBound();
      transitioning = false;
      pending = null;
    },
  };
}
