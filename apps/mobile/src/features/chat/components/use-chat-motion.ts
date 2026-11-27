import type { AnchoredEndSpaceConfig, LegendListRef } from "@legendapp/list/react-native";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent } from "react-native";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import {
  cancelAnimation,
  Easing,
  makeMutable,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { supportLog } from "@/features/support/model/support-log";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { type ChatLatestPlace, chatContentHiddenBy, chatContentIsVisible, chatLatestPlace } from "../model/chat-layout";

export const CHAT_ROW_GAP = 10;
const FOCUS_GAP = 12;
const FOCUS_PLACE_ATTEMPTS = 6;
const FOCUS_PLACE_TOLERANCE = 1;

function afterLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
const ANDROID_PLACE_FRAMES = 2;
const ANDROID_PLACE_TIMEOUT_MS = 250;
const KEYBOARD_SETTLE_MS = 450;
const SEND_STILL_FRAMES = 3;

const CATCH_UP_HOLD_MS = 1200;

const FOLLOW_SHIFT_MS = 300;

const OWN_GLIDE_CAP_MS = 1000;

const REVEAL_MS = 240;
const REVEAL_RISE = 14;
const REVEAL_EASE = Easing.bezier(0.2, 0, 0, 1);

const FALLBACK_KEYBOARD_MS = 240;

const ANTICIPATE_MS = 280;

const ANTICIPATE_WAIT_MS = 1200;

const KEYBOARD_MOVE_SAFETY_MS = 700;

const lastKeyboardHeight = makeMutable(0);

const framesMissing = makeMutable(false);

const framesSeen = makeMutable(false);

function reportSettledKeyboard(height: number): void {
  supportLog.add(
    "info",
    "app",
    `Keyboard reported only when settled (no IME animation frames, or a resize): ${Math.round(height)} dp`,
  );
}
type AnchorReadyInfo = Parameters<NonNullable<AnchoredEndSpaceConfig["onReady"]>>[0];

export function useChatMotion(
  header: number,
  keyboardOffset: number,
  ready: boolean,
  hasRows: boolean,
  lastUserId: string | null,
  requiredInputId: string | null = null,
  holdOpening = false,
  catchingUp = false,
  /** Build 11: opened by the ColorOS zoom. The chat's own open is the fade, so no inner fade. */
  zoomed = false,
) {
  const listRef = useRef<LegendListRef>(null);
  const reducedMotion = useReducedMotion();
  const keyboardHeight = useSharedValue(0);
  const keyboardProgress = useSharedValue(0);
  const keyboardDismissed = useSharedValue(false);
  const colorOS = useColorOSMotion().enabled;
  const fallback = useSharedValue(isAndroid && colorOS && !reducedMotion);
  const colorOSAndroid = useSharedValue(isAndroid && colorOS);
  useEffect(() => {
    fallback.set(isAndroid && colorOS && !reducedMotion);
    colorOSAndroid.set(isAndroid && colorOS);
  }, [fallback, colorOSAndroid, colorOS, reducedMotion]);

  const keyboardEvents = useSharedValue(0);

  const keyboardMoving = useSharedValue(false);

  const keyboardTarget = useSharedValue(0);
  const keyboardFromDown = useSharedValue(true);
  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        keyboardEvents.set(keyboardEvents.get() + 1);
        keyboardMoving.set(true);
        keyboardFromDown.set(keyboardTarget.get() <= 0);
        keyboardTarget.set(event.height);
        if (event.height > 0) {
          // Fallback: the settled burst (duration 0) leaves an anticipated lift running; onEnd lands it.
          if (!(fallback.get() && event.duration === 0)) {
            cancelAnimation(keyboardHeight);
            cancelAnimation(keyboardProgress);
          }
          keyboardDismissed.set(false);
          lastKeyboardHeight.set(event.height);
          // Fallback: ride to the destination on the keyboard's own duration, only on a phone known to
          // send no IME frames. Build 11.2 (stutter on focus): where frames come, a timing started here
          // ran ahead of the IME (out-cubic is front-loaded) and the first real frame pulled the
          // composer back down: a visible back-step, and the composer out of step with the
          // keyboard-aware list. The frames alone drive it now.
          if (fallback.get() && event.duration > 0 && framesMissing.get()) {
            const timing = {
              duration: event.duration,
              easing: Easing.out(Easing.cubic),
              reduceMotion: ReduceMotion.System,
            };
            keyboardHeight.set(withTiming(event.height, timing));
            keyboardProgress.set(withTiming(1, timing));
          }
        } else if (isAndroid && event.duration > 0 && !(fallback.get() && framesMissing.get())) {
          // Build 11.3 motion B8 (audit N06), Build 16.1 for every Android chat (Syed's video: the composer
          // dropped under the closing keyboard): the hide follows the IME frames like the show, so the
          // composer, the keyboard-aware list and the IME stay locked frame by frame. An own out-cubic
          // timing ran ahead of the IME, and the ColorOS gate missed phones where a resize had set
          // `framesMissing`. onEnd lands it at 0; iOS keeps the timing below (a dismissal there can omit
          // its last frame).
          keyboardDismissed.set(false);
          cancelAnimation(keyboardHeight);
          cancelAnimation(keyboardProgress);
        } else {
          keyboardDismissed.set(true);
          const duration = fallback.get() && event.duration === 0 ? FALLBACK_KEYBOARD_MS : Math.max(0, event.duration);
          const timing = {
            duration,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
          };
          keyboardHeight.set(withTiming(0, timing));
          keyboardProgress.set(withTiming(0, timing));
        }
      },
      onMove: (event) => {
        "worklet";
        if (keyboardDismissed.get()) return;
        // Fallback: the settled burst (duration 0) is animated in onEnd, not jumped to here.
        if (fallback.get() && event.duration === 0 && event.height > 0) return;
        // Real frames: this phone animates the IME, so focus never anticipates it.
        if (event.duration > 0) {
          framesMissing.set(false);
          framesSeen.set(true);
        }
        keyboardHeight.set(event.progress === 0 ? 0 : event.height);
        keyboardProgress.set(event.progress);
      },
      onInteractive: (event) => {
        "worklet";
        if (keyboardDismissed.get()) return;
        keyboardHeight.set(event.progress === 0 ? 0 : event.height);
        keyboardProgress.set(event.progress);
      },
      onEnd: (event) => {
        "worklet";
        keyboardMoving.set(false);
        if (event.height <= 0 || event.progress === 0) {
          keyboardDismissed.set(true);
          // Fallback: a return that is still animating (from onStart) finishes on its own.
          if (fallback.get() && keyboardHeight.get() > 0) {
            const timing = {
              duration: FALLBACK_KEYBOARD_MS,
              easing: Easing.out(Easing.cubic),
              reduceMotion: ReduceMotion.System,
            };
            keyboardHeight.set(withTiming(0, timing));
            keyboardProgress.set(withTiming(0, timing));
            return;
          }
          keyboardHeight.set(0);
          keyboardProgress.set(0);
        } else if (!keyboardDismissed.get()) {
          lastKeyboardHeight.set(event.height);
          // A show reported only once settled: this phone sends no IME frames. Only where the fallback runs
          // (ColorOS ON, Android): OFF stays build 9 and says nothing. Build 16.1: only a show that started
          // with the keyboard down; a resize of an open keyboard (its suggestion strip) is no evidence.
          if (fallback.get() && event.duration === 0 && keyboardFromDown.get() && !framesMissing.get()) {
            framesMissing.set(true);
            scheduleOnRN(reportSettledKeyboard, event.height);
          }
          if (fallback.get() && event.duration === 0 && Math.abs(keyboardHeight.get() - event.height) > 1) {
            const timing = {
              duration: FALLBACK_KEYBOARD_MS,
              easing: Easing.out(Easing.cubic),
              reduceMotion: ReduceMotion.System,
            };
            keyboardHeight.set(withTiming(event.height, timing));
            keyboardProgress.set(withTiming(event.progress, timing));
            return;
          }
          keyboardHeight.set(event.height);
          keyboardProgress.set(event.progress);
        }
      },
    },
    [
      keyboardHeight,
      keyboardProgress,
      keyboardDismissed,
      fallback,
      keyboardEvents,
      keyboardMoving,
      keyboardTarget,
      keyboardFromDown,
    ],
  );
  useEffect(() => {
    let safety: ReturnType<typeof setTimeout> | undefined;

    const armSafety = () => {
      if (safety) clearTimeout(safety);
      safety = setTimeout(() => {
        safety = undefined;
        if (!keyboardMoving.get()) return;
        keyboardMoving.set(false);
        if (!Keyboard.isVisible() && keyboardHeight.get() > 0) land();
      }, KEYBOARD_MOVE_SAFETY_MS);
    };
    const shown = Keyboard.addListener("keyboardDidShow", armSafety);
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      // Build 16.1 (Syed's video: the composer fell under the keyboard while it was still closing): on
      // Android this can come while the IME still animates down. The frames and onEnd land the composer
      // then; this lands it only if they never come.
      if (isAndroid && keyboardMoving.get()) {
        armSafety();
        return;
      }
      land();
    });
    function land(): void {
      keyboardDismissed.set(true);
      if (fallback.get() && keyboardHeight.get() > 0) {
        // Fallback: this arrives with the settled burst; the composer glides down instead of jumping.
        const timing = {
          duration: FALLBACK_KEYBOARD_MS,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        };
        keyboardHeight.set(withTiming(0, timing));
        keyboardProgress.set(withTiming(0, timing));
        return;
      }
      keyboardHeight.set(0);
      keyboardProgress.set(0);
    }
    return () => {
      if (safety) clearTimeout(safety);
      shown.remove();
      subscription.remove();
    };
  }, [keyboardHeight, keyboardProgress, keyboardDismissed, fallback, keyboardMoving]);
  /**
   * Build 10 fallback: the composer's input took focus with the keyboard down. Where the phone sends
   * no IME frames, start lifting at once to the last keyboard height, so the composer rises with the
   * keyboard instead of after it; the settled event corrects the height. No keyboard within
   * ANTICIPATE_WAIT_MS (a hardware keyboard) lowers it again.
   */
  const anticipateKeyboard = useCallback(() => {
    if (!fallback.get() || keyboardHeight.get() > 0) return;
    const height = lastKeyboardHeight.get();
    if (height <= 0 || !framesMissing.get()) return;
    const events = keyboardEvents.get();
    keyboardDismissed.set(false);
    const timing = { duration: ANTICIPATE_MS, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
    keyboardHeight.set(withTiming(height, timing));
    keyboardProgress.set(withTiming(1, timing));
    setTimeout(() => {
      if (keyboardEvents.get() !== events) return;
      keyboardDismissed.set(true);
      keyboardHeight.set(withTiming(0, timing));
      keyboardProgress.set(withTiming(0, timing));
    }, ANTICIPATE_WAIT_MS);
  }, [fallback, keyboardHeight, keyboardProgress, keyboardDismissed, keyboardEvents]);
  const composerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboardHeight.get() - keyboardOffset) }],
  }));
  const composerHeight = useSharedValue(0);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const atEnd = useSharedValue(false);
  const lowestOffset = useSharedValue(0);
  const scrolledUp = useSharedValue(false);
  const firstOffset = useSharedValue(0);
  const firstOpacity = useSharedValue(1);
  const responseOpacity = useSharedValue(1);
  const revealed = useSharedValue(false);
  const streamFollow = useSharedValue(false);
  const ownGlide = useSharedValue(false);
  const followShift = useSharedValue(0);
  const ownGlides = useRef(0);
  const glideToEnd = useCallback(() => {
    ownGlides.current += 1;
    const glide = ownGlides.current;
    ownGlide.set(true);
    const done = () => {
      if (glide === ownGlides.current) ownGlide.set(false);
    };
    setTimeout(done, OWN_GLIDE_CAP_MS);
    const scroll = listRef.current?.scrollToEnd({ animated: true });
    if (scroll) void scroll.then(done, done);
    else done();
    return scroll;
  }, [ownGlide]);
  const [atLatest, setAtLatest] = useState(false);
  const atLatestNow = useRef(false);
  const [latestPlace, setLatestPlace] = useState<ChatLatestPlace>("latest");
  const sentLatestPlace = useSharedValue<ChatLatestPlace | null>(null);

  const endAfterKeyboard = useRef(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [responseVisible, setResponseVisible] = useState(true);
  const [sendSettling, setSendSettling] = useState(false);
  const pending = useRef<{ baseline: string | null; first: boolean; fromLatest: boolean } | null>(null);
  const followLatest = useRef(true);
  const [keyboardLiftBehavior, setKeyboardLiftBehavior] = useState<"whenAtEnd" | "never">("whenAtEnd");
  const [latestGeneration, setLatestGeneration] = useState(0);
  const lastRequiredInputId = useRef(requiredInputId);
  const requiredInputFrame = useRef<number | null>(null);
  const sendScrollFrame = useRef<number | null>(null);
  const sendGeneration = useRef(0);
  const measurements = useRef({ viewport: 0, content: 0, composer: 0 });
  const [placedWithRows, setPlacedWithRows] = useState<boolean | null>(null);
  const listPlaced = !hasRows || placedWithRows === true;
  const shown = useRef(false);
  const holdsCatchUp = isAndroid && colorOS;
  const [catchUpWaited, setCatchUpWaited] = useState(!holdsCatchUp);
  useEffect(() => {
    if (catchUpWaited) return;
    const timer = setTimeout(() => setCatchUpWaited(true), CATCH_UP_HOLD_MS);
    return () => clearTimeout(timer);
  }, [catchUpWaited]);
  const [catchUpSettled, setCatchUpSettled] = useState(!catchingUp);

  const [openingFollow, setOpeningFollow] = useState(!holdOpening);

  const openingFollowNow = useRef(openingFollow);
  openingFollowNow.current = openingFollow && !holdOpening;
  useEffect(() => {
    if (!holdsCatchUp || shown.current) return;
    if (catchingUp) {
      if (catchUpSettled) setCatchUpSettled(false);
      return;
    }
    if (catchUpSettled) return;
    let live = true;
    let frame: number | null = null;
    const settle = () => {
      if (live) frame = requestAnimationFrame(() => setCatchUpSettled(true));
    };
    const scroll =
      openingFollowNow.current && !scrolledUp.get() ? listRef.current?.scrollToEnd({ animated: false }) : undefined;
    if (scroll) void scroll.then(settle, settle);
    else settle();
    return () => {
      live = false;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [holdsCatchUp, catchingUp, catchUpSettled, scrolledUp]);
  const catchUpHold = holdsCatchUp && !catchUpWaited && (catchingUp || !catchUpSettled);
  const [pinnedToLatest, setPinnedToLatest] = useState(false);
  const heldOpening = useRef(holdOpening);
  const current = useRef({ lastUserId });
  current.current = { lastUserId };

  const finishFirstMessage = useCallback(() => setResponseVisible(true), []);
  /**
   * Build #101/#102: while the chat is pinned, it keeps the end. Build 16.1 (Syed's video: the messages
   * jumped up and down as the keyboard opened): while the keyboard moves, the keyboard-aware list moves
   * its content frame by frame on the UI thread, and a jump to the end under it fought those frames, so
   * the scroll waits for the keyboard's End.
   */
  const keepEnd = useCallback(() => {
    if (!openingFollowNow.current || scrolledUp.get()) return;
    if (keyboardMoving.get()) {
      endAfterKeyboard.current = true;
      return;
    }
    void listRef.current?.scrollToEnd({ animated: false });
  }, [scrolledUp, keyboardMoving]);
  const keepEndAfterKeyboard = useCallback(() => {
    if (!endAfterKeyboard.current) return;
    endAfterKeyboard.current = false;
    keepEnd();
  }, [keepEnd]);
  useAnimatedReaction(
    () => keyboardMoving.get(),
    (moving, previous) => {
      if (!moving && previous === true) scheduleOnRN(keepEndAfterKeyboard);
    },
  );
  const updateLatestPlace = useCallback(
    (place: ChatLatestPlace) => {
      const visible = place === "latest";
      atLatestNow.current = visible;
      setAtLatest(visible);
      setLatestPlace(place);
      // Build #102: a pinned chat that came to rest above the latest message takes the end again.
      if (!visible) keepEnd();
    },
    [keepEnd],
  );
  const reveal = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    revealed.set(true);
    if (zoomed) startTransition(() => setHistoryVisible(true));
    else setHistoryVisible(true);
  }, [revealed, zoomed]);
  const onListReady = useCallback((withRows: boolean) => setPlacedWithRows(withRows), []);

  useLayoutEffect(() => {
    if (holdOpening) heldOpening.current = true;
    if (shown.current || !listPlaced || !ready || holdOpening || catchUpHold) return;
    const held = heldOpening.current;
    heldOpening.current = false;
    if (held) {
      void (listRef.current?.scrollToEnd({ animated: false }) ?? Promise.resolve()).then(reveal, reveal);
      return;
    }
    if (!hasRows) {
      reveal();
      return;
    }
    let live = true;
    const finish = () => {
      if (live) reveal();
    };
    void (listRef.current?.scrollToEnd({ animated: false }) ?? Promise.resolve()).then(finish, finish);
    return () => {
      live = false;
    };
  }, [listPlaced, ready, holdOpening, catchUpHold, hasRows, reveal]);
  useEffect(() => {
    if (!isAndroid || shown.current || !hasRows || placedWithRows === true || !ready || holdOpening) return;
    const started = Date.now();
    let measuredFrames = 0;
    let frame = requestAnimationFrame(function place() {
      const list = listRef.current;
      const state = list?.getState();
      const last = state ? state.data.length - 1 : -1;
      if (state && last >= 0 && state.sizeAtIndex(last) > 0) measuredFrames += 1;
      const placeFrames = zoomed ? 0 : ANDROID_PLACE_FRAMES;
      if (list && (measuredFrames > placeFrames || Date.now() - started >= ANDROID_PLACE_TIMEOUT_MS)) {
        void list.scrollToEnd({ animated: false }).then(() => setPlacedWithRows(true));
        return;
      }
      frame = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasRows, placedWithRows, ready, holdOpening, zoomed]);
  // Build #102 (Syed's phone, every agent: opened at older messages, then jumped): #101's follow ended
  // after 600 ms of still content, but on the phone the list could come to rest above the end (catch-up
  // page, rows measured late) with nothing left to move it. The opening chat now stays pinned to the
  // latest message until the reader drags, scrolls away or sends: no timer can end it early.
  useLayoutEffect(() => {
    if (requiredInputId !== lastRequiredInputId.current && requiredInputId && followLatest.current && shown.current) {
      if (requiredInputFrame.current !== null) cancelAnimationFrame(requiredInputFrame.current);
      requiredInputFrame.current = requestAnimationFrame(() => {
        requiredInputFrame.current = null;
        if (!followLatest.current) return;
        if (reducedMotion) void listRef.current?.scrollToEnd({ animated: false });
        else void glideToEnd();
      });
    }
    lastRequiredInputId.current = requiredInputId;
  }, [requiredInputId, reducedMotion, glideToEnd]);
  useEffect(
    () => () => {
      if (requiredInputFrame.current !== null) cancelAnimationFrame(requiredInputFrame.current);
      if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
      sendGeneration.current += 1;
    },
    [],
  );

  const onViewportLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      measurements.current.viewport = event.nativeEvent.layout.height;
      viewport.set(event.nativeEvent.layout.height);
    },
    [viewport],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      measurements.current.content = height;
      content.set(height);
      // Build #101/#102: while the chat is pinned, any growth (rows measured, latest page, end space) keeps the end.
      keepEnd();
    },
    [content, keepEnd],
  );
  // Build 15.2 (Syed: the composer's grow on tap stuttered as the keyboard opened): the composer grows
  // with the keyboard's progress, and its layout reported each frame of that grow to JS, which moved the
  // list's end space a frame late every time. With ColorOS motion on, a height measured while the
  // keyboard is between down and up waits, and the latest one lands once when the keyboard settles.
  const heldComposer = useRef<number | null>(null);
  const setComposer = useCallback(
    (height: number) => {
      const grew = height !== measurements.current.composer;
      measurements.current.composer = height;
      composerHeight.set(height);
      // Build #102 (typing a long message moved the chat): a pinned chat keeps the end as the composer grows.
      if (grew && openingFollowNow.current && !scrolledUp.get()) requestAnimationFrame(keepEnd);
    },
    [composerHeight, scrolledUp, keepEnd],
  );
  const onComposerLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      const height = event.nativeEvent.layout.height + 20;
      const progress = keyboardProgress.get();
      if (fallback.get() && progress > 0 && progress < 1) {
        heldComposer.current = height;
        return;
      }
      heldComposer.current = null;
      setComposer(height);
    },
    [fallback, keyboardProgress, setComposer],
  );
  const landHeldComposer = useCallback(() => {
    const height = heldComposer.current;
    heldComposer.current = null;
    if (height !== null) setComposer(height);
  }, [setComposer]);
  useAnimatedReaction(
    () => keyboardProgress.get() <= 0 || keyboardProgress.get() >= 1,
    (settled, previous) => {
      if (settled && previous === false) scheduleOnRN(landHeldComposer);
    },
  );

  useLayoutEffect(() => {
    const send = pending.current;
    if (!isAndroid || !colorOS || !send || lastUserId === null || lastUserId === send.baseline) return;
    pending.current = null;
    reveal();
    const generation = sendGeneration.current;
    if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    const started = Date.now();
    let lastSizes = "";
    let stillFrames = 0;
    const finish = () => {
      if (generation === sendGeneration.current) {
        setSendSettling(false);
        setPinnedToLatest(true);
      }
    };
    const step = () => {
      if (generation !== sendGeneration.current) return;
      const sizes = `${content.get()}:${composerHeight.get()}:${scrollOffset.get()}`;
      stillFrames = sizes === lastSizes ? stillFrames + 1 : 0;
      lastSizes = sizes;
      if ((keyboardMoving.get() || stillFrames < SEND_STILL_FRAMES) && Date.now() - started < KEYBOARD_SETTLE_MS) {
        sendScrollFrame.current = requestAnimationFrame(step);
        return;
      }
      sendScrollFrame.current = null;
      if (stillFrames < SEND_STILL_FRAMES || atEnd.get()) {
        finish();
        return;
      }
      const scroll = reducedMotion ? listRef.current?.scrollToEnd({ animated: false }) : glideToEnd();
      if (scroll) void scroll.then(finish, finish);
      else finish();
    };
    sendScrollFrame.current = requestAnimationFrame(step);
    return () => {
      if (generation !== sendGeneration.current) return;
      sendGeneration.current += 1;
      if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
      sendScrollFrame.current = null;
    };
  }, [
    lastUserId,
    colorOS,
    content,
    composerHeight,
    scrollOffset,
    atEnd,
    keyboardMoving,
    reducedMotion,
    reveal,
    glideToEnd,
  ]);
  const onAnchorReady = useCallback(
    (info: AnchorReadyInfo, anchorMaxSize?: number) => {
      const send = pending.current;
      const list = listRef.current;
      if (!send || !list || info.anchorKey === undefined || info.anchorKey === send.baseline) return;
      pending.current = null;
      setSendSettling(false);
      reveal();
      const animated = !send.first && send.fromLatest && !reducedMotion;
      if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
      if (animated) {
        // Build 11.2 (stutter on send): Send dismisses the keyboard, and the keyboard-aware list moves
        // its content with the keyboard on the UI thread. An animated scroll started mid-dismissal
        // aimed at an end that kept moving under it, and the two fought. The scroll waits for the
        // keyboard to settle (at most KEYBOARD_SETTLE_MS), then glides once.
        const started = Date.now();
        // Build 14 (Syed: the scroll to a sent message stuttered after a long reply): the glide is ONE
        // scroll to the end the list will have. It also waits (same bound) for a frame where the
        // composer (its text cleared) and the list's content (the new row, its end space) kept their
        // size, so the end does not move under the glide and nothing has to correct it after.
        let lastSizes = "";
        const step = () => {
          const sizes = `${content.get()}:${composerHeight.get()}`;
          const moving = sizes !== lastSizes;
          lastSizes = sizes;
          // ColorOS motion only (the fallback's switch): OFF scrolls as build 11 did.
          if (fallback.get() && (keyboardMoving.get() || moving) && Date.now() - started < KEYBOARD_SETTLE_MS) {
            sendScrollFrame.current = requestAnimationFrame(step);
            return;
          }
          sendScrollFrame.current = null;
          void glideToEnd();
        };
        sendScrollFrame.current = requestAnimationFrame(() => {
          sendScrollFrame.current = requestAnimationFrame(step);
        });
      } else {
        sendScrollFrame.current = null;
        void list.scrollToEnd({ animated: false });
      }
      if (!send.first || info.anchorIndex === undefined) return;
      const m = measurements.current;
      const lift = Math.max(0, keyboardHeight.get() - keyboardOffset);
      const rowHeight = list.getState().sizeAtIndex(info.anchorIndex);
      const userHeight = Math.max(0, Math.min(rowHeight, anchorMaxSize ?? rowHeight) - CHAT_ROW_GAP);
      firstOffset.set(Math.max(0, m.viewport - lift - m.composer - header - userHeight));
      firstOpacity.set(withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System }));
      firstOffset.set(
        withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }, (finished) => {
          if (!finished) return;
          responseOpacity.set(withTiming(1, { duration: 350, reduceMotion: ReduceMotion.System }));
          scheduleOnRN(finishFirstMessage);
        }),
      );
    },
    [
      composerHeight,
      content,
      finishFirstMessage,
      firstOffset,
      firstOpacity,
      fallback,
      glideToEnd,
      header,
      keyboardHeight,
      keyboardMoving,
      keyboardOffset,
      reducedMotion,
      responseOpacity,
      reveal,
    ],
  );

  // Build 16.1: read only while the keyboard is still (see `chatLatestPlace`): during its move the list
  // reports its scroll a frame after the keyboard and the composer move, which read as "not at the latest
  // message" for a frame, flashed the arrow and made the pinned chat jump to the end under the keyboard.
  useAnimatedReaction(
    () =>
      chatLatestPlace(
        chatContentHiddenBy(
          content.get(),
          viewport.get(),
          scrollOffset.get(),
          composerHeight.get() + Math.max(0, keyboardHeight.get() - keyboardOffset),
        ),
        revealed.get(),
        keyboardMoving.get(),
      ),
    (place) => {
      if (place === null || place === sentLatestPlace.get()) return;
      sentLatestPlace.set(place);
      scheduleOnRN(updateLatestPlace, place);
    },
  );
  useAnimatedReaction(
    () => scrollOffset.get(),
    (y, previous) => {
      if (previous === null || y <= previous) return;
      if (!streamFollow.get() || dragging.get() || keyboardMoving.get() || !revealed.get() || ownGlide.get()) return;
      followShift.set(Math.min(header, followShift.get() + y - previous));
      followShift.set(withSpring(0, { duration: FOLLOW_SHIFT_MS, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
    },
  );
  useAnimatedReaction(
    () => scrollOffset.get(),
    (y) => {
      if (!revealed.get() || scrolledUp.get()) return;
      if (colorOSAndroid.get() && !dragging.get()) {
        lowestOffset.set(y);
        return;
      }
      lowestOffset.set(Math.max(lowestOffset.get(), y));
      if (y >= lowestOffset.get() - 24) return;
      scrolledUp.set(true);
      scheduleOnRN(setUserScrolled, true);
    },
  );
  // Build 13 (Syed: "when it loads, the chat animates beautifully after the skeletal loading"): a
  // zoom-opened chat's rows fade in and rise into place over the skeleton's fade, already at the latest
  // message (the list is placed before it reveals, so nothing scrolls). Other chats keep the 150 ms fade.
  const historyStyle = useAnimatedStyle(() =>
    zoomed
      ? {
          opacity: withTiming(revealed.get() ? 1 : 0, {
            duration: revealed.get() ? REVEAL_MS : 0,
            easing: REVEAL_EASE,
            reduceMotion: ReduceMotion.System,
          }),
          transform: [
            {
              translateY: withTiming(revealed.get() ? 0 : REVEAL_RISE, {
                duration: revealed.get() ? REVEAL_MS : 0,
                easing: REVEAL_EASE,
                reduceMotion: ReduceMotion.System,
              }),
            },
          ],
        }
      : { opacity: withTiming(revealed.get() ? 1 : 0, { duration: 150, reduceMotion: ReduceMotion.System }) },
  );
  const firstMessageStyle = useAnimatedStyle(() => ({
    opacity: firstOpacity.get(),
    transform: [{ translateY: firstOffset.get() }],
  }));
  const responseStyle = useAnimatedStyle(() => ({ opacity: responseOpacity.get() }));

  const beginSend = useCallback(() => {
    sendGeneration.current += 1;
    if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    sendScrollFrame.current = null;
    openingFollowNow.current = false;
    setOpeningFollow(false);
    setPinnedToLatest(isAndroid && colorOS);
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    const baseline = current.current.lastUserId;
    const first = baseline === null;
    pending.current = { baseline, first, fromLatest: atLatestNow.current };
    setSendSettling(true);
    if (isAndroid && colorOS) {
      scrolledUp.set(false);
      lowestOffset.set(scrollOffset.get());
      setUserScrolled(false);
      // No header anchor: even the first reply stays visible beside its sent message.
      firstOpacity.set(1);
      responseOpacity.set(1);
      setResponseVisible(true);
    } else if (first) {
      firstOpacity.set(0);
      responseOpacity.set(0);
      setResponseVisible(false);
    }
  }, [colorOS, firstOpacity, responseOpacity, scrolledUp, lowestOffset, scrollOffset]);
  const cancelSend = useCallback(() => {
    sendGeneration.current += 1;
    pending.current = null;
    setSendSettling(false);
    if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    sendScrollFrame.current = null;
    cancelAnimation(firstOffset);
    firstOffset.set(0);
    firstOpacity.set(1);
    responseOpacity.set(1);
    setResponseVisible(true);
  }, [firstOffset, firstOpacity, responseOpacity]);
  const leaveLatest = useCallback(() => {
    sendGeneration.current += 1;
    if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    sendScrollFrame.current = null;
    openingFollowNow.current = false;
    setOpeningFollow(false);
    setUserScrolled(true);
    setPinnedToLatest(false);
    followLatest.current = false;
    setKeyboardLiftBehavior("never");
  }, []);
  const followFrom = useCallback(
    (scrollY: number) => {
      const m = measurements.current;
      followLatest.current = chatContentIsVisible(
        m.content,
        m.viewport,
        scrollY,
        m.composer + Math.max(0, keyboardHeight.get() - keyboardOffset),
      );
      setKeyboardLiftBehavior(followLatest.current ? "whenAtEnd" : "never");
    },
    [keyboardHeight, keyboardOffset],
  );
  const drags = useRef(0);
  const onScrollBeginDrag = useCallback(() => {
    openingFollowNow.current = false;
    drags.current += 1;
    dragging.set(true);
    setOpeningFollow(false);
    leaveLatest();
    reveal();
    cancelSend();
  }, [leaveLatest, reveal, cancelSend, dragging]);
  const openAt = useCallback(
    async (index: number, unread = false): Promise<void> => {
      if (unread) followLatest.current = false;
      else leaveLatest();
      const startDrags = drags.current;
      let shown: number | null = null;
      try {
        for (let attempt = 0; attempt < FOCUS_PLACE_ATTEMPTS; attempt += 1) {
          const list = listRef.current;
          if (!list || drags.current !== startDrags) break;
          await list.scrollToIndex({ index, viewOffset: header + FOCUS_GAP, animated: false });
          await afterLayout();
          const state = listRef.current?.getState();
          if (!state) break;
          const next = state.positionAtIndex(index) - state.scroll;
          if (shown !== null && Math.abs(next - shown) <= FOCUS_PLACE_TOLERANCE) break;
          shown = next;
        }
      } catch {}
      reveal();
      const state = unread && drags.current === startDrags ? listRef.current?.getState() : undefined;
      if (state) followFrom(state.scroll);
    },
    [leaveLatest, header, reveal, followFrom],
  );
  const returnToLatest = useCallback((pin = false) => {
    followLatest.current = true;
    setPinnedToLatest(pin);
    setKeyboardLiftBehavior("whenAtEnd");
    setLatestGeneration((generation) => generation + 1);
  }, []);
  const onScrollEndDrag = useCallback(
    (event: { nativeEvent: Pick<NativeScrollEvent, "contentOffset"> }) => {
      dragging.set(false);
      followFrom(event.nativeEvent.contentOffset.y);
    },
    [followFrom, dragging],
  );
  const scrollToLatest = useCallback(() => {
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    if (reducedMotion) void listRef.current?.scrollToEnd({ animated: false });
    else void glideToEnd();
  }, [reducedMotion, glideToEnd]);
  const handOffOpening = useCallback(() => {
    if (!shown.current || !openingFollowNow.current || scrolledUp.get()) return;
    openingFollowNow.current = false;
    setOpeningFollow(false);
    setPinnedToLatest(true);
  }, [scrolledUp]);
  const pinToLatest = useCallback(() => {
    setPinnedToLatest(true);
    scrollToLatest();
  }, [scrollToLatest]);
  const openingFollowOn = openingFollow && !holdOpening;
  const followsEnd =
    (requiredInputId !== null && keyboardLiftBehavior === "whenAtEnd") || openingFollowOn || pinnedToLatest;
  const followMode: "opening" | "reply" | null = openingFollowOn ? "opening" : followsEnd ? "reply" : null;

  return useMemo(
    () => ({
      listRef,
      listPlaced,
      startsAtEnd: !holdOpening,
      atLatest,
      latestPlace,
      userScrolled,
      historyVisible,
      responseVisible,
      sendSettling,
      composerHeight,
      composerStyle,
      keyboardHeight,
      keyboardProgress,
      anticipateKeyboard,
      keyboardLiftBehavior,
      followsEnd,
      followMode,
      scrollOffset,
      dragging,
      atEnd,
      streamFollow,
      followShift,
      handOffOpening,
      historyStyle,
      revealed,
      firstMessageStyle,
      responseStyle,
      onListReady,
      onAnchorReady,
      onViewportLayout,
      onContentSizeChange,
      onComposerLayout,
      onScrollBeginDrag,
      onScrollEndDrag,
      beginSend,
      cancelSend,
      scrollToLatest,
      pinToLatest,
      openAt,
      returnToLatest,
      latestGeneration,
    }),
    [
      listPlaced,
      holdOpening,
      atLatest,
      latestPlace,
      userScrolled,
      historyVisible,
      responseVisible,
      sendSettling,
      composerHeight,
      composerStyle,
      keyboardHeight,
      keyboardProgress,
      anticipateKeyboard,
      keyboardLiftBehavior,
      followsEnd,
      followMode,
      scrollOffset,
      dragging,
      atEnd,
      streamFollow,
      followShift,
      handOffOpening,
      historyStyle,
      revealed,
      firstMessageStyle,
      responseStyle,
      onListReady,
      onAnchorReady,
      onViewportLayout,
      onContentSizeChange,
      onComposerLayout,
      onScrollBeginDrag,
      onScrollEndDrag,
      beginSend,
      cancelSend,
      scrollToLatest,
      pinToLatest,
      openAt,
      returnToLatest,
      latestGeneration,
    ],
  );
}

export type ChatMotion = ReturnType<typeof useChatMotion>;
