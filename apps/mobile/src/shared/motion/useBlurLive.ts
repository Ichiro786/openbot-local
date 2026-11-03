import { useEffect, useState } from "react";

/**
 * Build 10: whether a BlurView that is `running` may be seen. False at once when it stops (so the blur
 * can switch to `none` in the same commit without its solid tint ever showing), true two frames after
 * it starts again (a restarted Dimezis blur can paint its tint for its first frame). Lets a paused frost
 * stop blurring the moment a menu takes its place instead of after its fade, so the screen never runs
 * more than two blurs, even for the length of a fade.
 */
export function useBlurLive(running: boolean): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!running) {
      setLive(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLive(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [running]);
  return running && live;
}
