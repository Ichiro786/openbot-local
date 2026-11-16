// E2E HARNESS (build 16.1): keyboard / composer / list probe inside the real ChatView.
// Per keyboard move (Start -> End + 6 frames) on the UI thread, every frame:
//   ime   = the IME height from keyboard-controller's own frames (independent subscription)
//   lift  = the value ChatView lifts the composer by (motion.keyboardHeight; translateY = -(lift - offset))
//   err   = lift - ime (dp): < 0 the composer is lower than the keyboard edge it should ride (covered),
//           > 0 it runs ahead of the keyboard
//   scroll reversals: the list's scroll offset changed direction (> 1 dp) during the move (list jumping)
// One logcat line per move: E2EKBMOVE dir=open|close frames= maxAhead= maxBehind= meanAbs= covered= scrollRev= ...
// plus E2EKBEV start|end t=<ms> lines, and E2EARROW on|off t=<ms> from the scroll-to-latest arrow's mount.
import { useEffect } from "react";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import { type SharedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

function e2eKbLog(line: string): void {
  console.log(`${line} t=${Date.now()}`);
}

export function E2EArrowMark() {
  useEffect(() => {
    e2eKbLog("E2EARROW on");
    return () => e2eKbLog("E2EARROW off");
  }, []);
  return null;
}

export function E2EKbProbe({ lift, scroll }: { lift: SharedValue<number>; scroll: SharedValue<number> }) {
  const ime = useSharedValue(0);
  const dir = useSharedValue(0);
  const tail = useSharedValue(-1);
  const frames = useSharedValue(0);
  const maxAhead = useSharedValue(0);
  const maxBehind = useSharedValue(0);
  const sumAbs = useSharedValue(0);
  const covered = useSharedValue(0);
  const lastScroll = useSharedValue(-1);
  const scrollDir = useSharedValue(0);
  const scrollRev = useSharedValue(0);
  const scrollTravel = useSharedValue(0);
  useKeyboardHandler(
    {
      onStart: (e) => {
        "worklet";
        dir.set(e.height > 0 ? 1 : -1);
        tail.set(-1);
        frames.set(0);
        maxAhead.set(0);
        maxBehind.set(0);
        sumAbs.set(0);
        covered.set(0);
        lastScroll.set(scroll.get());
        scrollDir.set(0);
        scrollRev.set(0);
        scrollTravel.set(0);
        scheduleOnRN(e2eKbLog, `E2EKBEV start h=${Math.round(e.height)} dur=${e.duration}`);
      },
      onMove: (e) => {
        "worklet";
        ime.set(e.height);
      },
      onInteractive: (e) => {
        "worklet";
        ime.set(e.height);
      },
      onEnd: (e) => {
        "worklet";
        ime.set(e.height);
        tail.set(6);
        scheduleOnRN(e2eKbLog, `E2EKBEV end h=${Math.round(e.height)}`);
      },
    },
    [],
  );
  useFrameCallback(() => {
    "worklet";
    if (dir.get() === 0) return;
    const err = lift.get() - ime.get();
    frames.set(frames.get() + 1);
    if (err > maxAhead.get()) maxAhead.set(err);
    if (-err > maxBehind.get()) maxBehind.set(-err);
    sumAbs.set(sumAbs.get() + Math.abs(err));
    if (err < -4) covered.set(covered.get() + 1);
    const s = scroll.get();
    const d = s - lastScroll.get();
    if (Math.abs(d) > 1) {
      const sign = d > 0 ? 1 : -1;
      if (scrollDir.get() !== 0 && sign !== scrollDir.get()) scrollRev.set(scrollRev.get() + 1);
      scrollDir.set(sign);
      scrollTravel.set(scrollTravel.get() + Math.abs(d));
      lastScroll.set(s);
    }
    const t = tail.get();
    if (t < 0) return;
    if (t > 0) {
      tail.set(t - 1);
      return;
    }
    const n = Math.max(1, frames.get());
    scheduleOnRN(
      e2eKbLog,
      `E2EKBMOVE dir=${dir.get() > 0 ? "open" : "close"} frames=${frames.get()} maxAhead=${maxAhead.get().toFixed(1)} maxBehind=${maxBehind.get().toFixed(1)} meanAbs=${(sumAbs.get() / n).toFixed(1)} covered=${covered.get()} scrollRev=${scrollRev.get()} scrollTravel=${scrollTravel.get().toFixed(0)} endLift=${lift.get().toFixed(1)} endIme=${ime.get().toFixed(1)}`,
    );
    dir.set(0);
    tail.set(-1);
  });
  return null;
}
