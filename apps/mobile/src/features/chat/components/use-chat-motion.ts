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
import { chatContentIsVisible } from "../model/chat-layout";

/** The space under each row of the list. */
export const CHAT_ROW_GAP = 10;
/** A message from search opens this far under the header. */
const FOCUS_GAP = 12;
/** On Android the chat takes the latest message this many frames after the last row has its size. */
const ANDROID_PLACE_FRAMES = 2;
/** The longest wait on Android before the chat takes the latest message, also without a measured row. */
const ANDROID_PLACE_TIMEOUT_MS = 250;

/** Build 11.2: the longest a sent message's scroll waits for the keyboard to finish moving. */
const KEYBOARD_SETTLE_MS = 450;
/**
 * Build 14 (Syed's phone, build 12 video 98 frame 140: a routine row that came with the latest page
 * shoved the opening chat up 48 dp mid-zoom): a zoom-opened chat that shows kept messages while its
 * latest page loads keeps its rows hidden under the skeleton until the page is in, this long at most
 * from the chat's mount. A page that is later still adds its rows at the end, as before.
 */
const CATCH_UP_HOLD_MS = 450;
/** Build 13: a zoom-opened chat's rows come in over this long, rising this far, on the ColorOS curve. */
const REVEAL_MS = 240;
const REVEAL_RISE = 14;
const REVEAL_EASE = Easing.bezier(0.2, 0, 0, 1);
/** Build 10 keyboard fallback: how long a settled keyboard change takes to animate. */
const FALLBACK_KEYBOARD_MS = 240;
/** Build 10 keyboard fallback: the anticipated lift on focus, about an IME's own rise. */
const ANTICIPATE_MS = 280;
/** Build 10 keyboard fallback: no keyboard this long after a focus lowers the anticipated lift. */
const ANTICIPATE_WAIT_MS = 1200;
/** The last keyboard height of the app (any chat), for the anticipated lift. */
const lastKeyboardHeight = makeMutable(0);
/** True once a keyboard show came only as a settled burst (no IME frames on this phone). */
const framesMissing = makeMutable(false);
/** Build 11.3 motion B8: this phone has sent real IME animation frames (duration > 0) at least once. */
const framesSeen = makeMutable(false);

/**
 * Build 10 diagnostic, declared before the keyboard worklets that call it: a keyboard that came only
 * as a settled event, so a support log from the phone says whether its IME sends animation frames.
 */
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
  /** The list has rows. Rows that come into an empty list get a new first position. */
  hasRows: boolean,
  lastUserId: string | null,
  requiredInputId: string | null = null,
  /** The chat opens at a message from search: do not move to the latest message while it loads. */
  holdOpening = false,
  /** The chat shows the messages that the phone kept, and reads the latest page of the host. */
  catchingUp = false,
  /** Build 11: opened by the ColorOS zoom. The chat's own open is the fade, so no inner fade. */
  zoomed = false,
) {
  const listRef = useRef<LegendListRef>(null);
  const reducedMotion = useReducedMotion();
  const keyboardHeight = useSharedValue(0);
  // 0 while the keyboard is down, 1 while it is fully up, and every value
  // between during an interactive dismissal. The composer reads this to size
  // itself, so a swipe drives the shape change frame by frame.
  const keyboardProgress = useSharedValue(0);
  const keyboardDismissed = useSharedValue(false);
  // Build 10 (ColorOS motion, Android): some phones send no IME animation frames (Syed's ColorOS
  // build). react-native-keyboard-controller then reports the keyboard only once it has settled,
  // as one Start/Move/End burst with duration 0, and the composer jumped. With the fallback on, a
  // duration-0 change animates instead, a Start with a duration animates to its destination until
  // real frames take over, and a focus starts the lift at the last keyboard height (see
  // `anticipateKeyboard`). With the fallback off the handler behaves exactly as before; with real
  // frames, each frame overwrites the fallback's timing on its first frame.
  const colorOS = useColorOSMotion().enabled;
  const fallback = useSharedValue(isAndroid && colorOS && !reducedMotion);
  useEffect(() => {
    fallback.set(isAndroid && colorOS && !reducedMotion);
  }, [fallback, colorOS, reducedMotion]);
  /** Bumped by each keyboard Start, so an anticipated lift knows whether the keyboard came. */
  const keyboardEvents = useSharedValue(0);
  /** Build 11.2: the keyboard is between its Start and its End (showing or hiding). */
  const keyboardMoving = useSharedValue(false);
  // Track opening and interactive frames. Once dismissal starts, finish the
  // return independently so a missing completion cannot retain keyboard space.
  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        keyboardEvents.set(keyboardEvents.get() + 1);
        keyboardMoving.set(true);
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
        } else if (fallback.get() && framesSeen.get() && !framesMissing.get() && event.duration > 0) {
          // Build 11.3 motion B8 (audit N06), ColorOS on Android with real IME frames: the hide follows
          // the frames like the show, so the composer, the keyboard-aware list and the IME stay locked
          // (an own out-cubic timing ran ahead of the IME). onEnd and keyboardDidHide still land it at 0.
          cancelAnimation(keyboardHeight);
          cancelAnimation(keyboardProgress);
        } else {
          // Complete the return from the destination event. An interrupted iOS
          // dismissal can omit its final frame; subsequent drag frames must not
          // cancel this animation and leave the composer above an absent keyboard.
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
          // A show reported only once settled: this phone sends no IME frames (or the keyboard resized).
          // Only where the fallback runs (ColorOS ON, Android): OFF stays build 9 and says nothing.
          if (fallback.get() && event.duration === 0 && !framesMissing.get()) {
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
    [keyboardHeight, keyboardProgress, keyboardDismissed, fallback, keyboardEvents, keyboardMoving],
  );
  useEffect(() => {
    // A native picker or interrupted dismissal can omit the controller's final frame.
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
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
    });
    return () => subscription.remove();
  }, [keyboardHeight, keyboardProgress, keyboardDismissed, fallback]);
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
  // The list writes its scroll position here on the UI thread, so scrolling runs no JavaScript here.
  const scrollOffset = useSharedValue(0);
  const lowestOffset = useSharedValue(0);
  const scrolledUp = useSharedValue(false);
  const firstOffset = useSharedValue(0);
  const firstOpacity = useSharedValue(1);
  const responseOpacity = useSharedValue(1);
  const revealed = useSharedValue(false);
  const [atLatest, setAtLatest] = useState(false);
  const atLatestNow = useRef(false);
  // The opening position is not the user's choice. Until the user drags the
  // list, the whole chat counts as seen, wherever the list lands.
  const [userScrolled, setUserScrolled] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [responseVisible, setResponseVisible] = useState(true);
  const pending = useRef<{ baseline: string | null; first: boolean; fromLatest: boolean } | null>(null);
  const followLatest = useRef(true);
  const [keyboardLiftBehavior, setKeyboardLiftBehavior] = useState<"whenAtEnd" | "never">("whenAtEnd");
  // Counts the returns to the latest messages from a window around a searched message.
  const [latestGeneration, setLatestGeneration] = useState(0);
  const lastRequiredInputId = useRef(requiredInputId);
  const requiredInputFrame = useRef<number | null>(null);
  const sendScrollFrame = useRef<number | null>(null);
  const measurements = useRef({ viewport: 0, content: 0, composer: 0 });
  // Whether the list had rows when it last finished its first position. Null until it does once.
  const [placedWithRows, setPlacedWithRows] = useState<boolean | null>(null);
  // Rows that come into an empty list get a new first position, so the list waits for it. An empty
  // list has no position to wait for, and Legend List calls `onReady` only after it lays out a row.
  const listPlaced = !hasRows || placedWithRows === true;
  const shown = useRef(false);
  // Build 14: a zoom open waits for a catch-up page (bounded), so its rows show once, complete.
  const [catchUpWaited, setCatchUpWaited] = useState(!zoomed);
  useEffect(() => {
    if (catchUpWaited) return;
    const timer = setTimeout(() => setCatchUpWaited(true), CATCH_UP_HOLD_MS);
    return () => clearTimeout(timer);
  }, [catchUpWaited]);
  const catchUpHold = zoomed && catchingUp && !catchUpWaited;
  // While the chat opens, the list keeps the latest message in view: older rows come above the
  // first rows and get their sizes, and the latest page can add messages after the kept ones.
  const [openingFollow, setOpeningFollow] = useState(!holdOpening);
  // Build #101: read by onContentSizeChange; the last time the list's content changed size.
  const openingFollowNow = useRef(openingFollow);
  openingFollowNow.current = openingFollow && !holdOpening;
  const contentChangedAt = useRef(0);
  const heldOpening = useRef(holdOpening);
  const current = useRef({ lastUserId });
  current.current = { lastUserId };

  const finishFirstMessage = useCallback(() => setResponseVisible(true), []);
  const updateAtLatest = useCallback(
    (visible: boolean) => {
      atLatestNow.current = visible;
      setAtLatest(visible);
      // Build #102: a pinned chat that came to rest above the latest message takes the end again.
      if (!visible && openingFollowNow.current && !scrolledUp.get())
        void listRef.current?.scrollToEnd({ animated: false });
    },
    [scrolledUp],
  );
  const reveal = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    revealed.set(true);
    // Build 11.3 council A5: for zoom-opened chats, every row's deferred content (web views, actions,
    // media) comes as a transition right after the UI-thread reveal. Build 14 (Syed's phone: Copy and Read
    // aloud popped in ~400 ms after the open started): no longer after the open settles; the icons land
    // while the rows fade in (their buttons always kept their size, so nothing moves).
    if (zoomed) startTransition(() => setHistoryVisible(true));
    else setHistoryVisible(true);
  }, [revealed, zoomed]);
  /** The list finished the first position of its rows. */
  const onListReady = useCallback((withRows: boolean) => setPlacedWithRows(withRows), []);

  // The list shows once it has its place at the latest message. A message from search shows it itself.
  useLayoutEffect(() => {
    // The hold stays recorded until the list shows: it can end while the history still loads.
    if (holdOpening) heldOpening.current = true;
    if (shown.current || !listPlaced || !ready || holdOpening || catchUpHold) return;
    const held = heldOpening.current;
    heldOpening.current = false;
    // The message from search did not open the chat, and the list did not take the end while it waited.
    if (held) void (listRef.current?.scrollToEnd({ animated: false }) ?? Promise.resolve()).then(reveal, reveal);
    else reveal();
  }, [listPlaced, ready, holdOpening, catchUpHold, reveal]);
  // Android moves the list to the latest message with a native scroll, and Legend List can wait for
  // seconds for that scroll to report before it calls `onReady`. Once the last row has its size,
  // the chat takes the end itself: this ends the wait, and the list calls `onReady`. iOS places the
  // list without a native scroll, so it keeps the wait.
  useEffect(() => {
    if (!isAndroid || shown.current || !hasRows || placedWithRows === true || !ready || holdOpening) return;
    const started = Date.now();
    let measuredFrames = 0;
    let frame = requestAnimationFrame(function place() {
      const list = listRef.current;
      const state = list?.getState();
      const last = state ? state.data.length - 1 : -1;
      // The size of a row is unset until the list has measured it.
      if (state && last >= 0 && state.sizeAtIndex(last) > 0) measuredFrames += 1;
      // Build 11.3 council B8: under the zoom's opaque surface the list is placed on the first frame its
      // last row has a size (the opening follow keeps the end while rows settle).
      const placeFrames = zoomed ? 0 : ANDROID_PLACE_FRAMES;
      if (list && (measuredFrames > placeFrames || Date.now() - started >= ANDROID_PLACE_TIMEOUT_MS)) {
        // The list calls `onReady` when this ends its wait. The end of the scroll places the list
        // also if it had no wait left to end.
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
      // The question row renders in this commit; its size is known from the next frame.
      if (requiredInputFrame.current !== null) cancelAnimationFrame(requiredInputFrame.current);
      requiredInputFrame.current = requestAnimationFrame(() => {
        requiredInputFrame.current = null;
        if (followLatest.current) void listRef.current?.scrollToEnd({ animated: !reducedMotion });
      });
    }
    lastRequiredInputId.current = requiredInputId;
  }, [requiredInputId, reducedMotion]);
  useEffect(
    () => () => {
      if (requiredInputFrame.current !== null) cancelAnimationFrame(requiredInputFrame.current);
      if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
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
      contentChangedAt.current = Date.now();
      // Build #101/#102: while the chat is pinned, any growth (rows measured, latest page, end space) keeps the end.
      if (openingFollowNow.current && !scrolledUp.get()) void listRef.current?.scrollToEnd({ animated: false });
    },
    [content, scrolledUp],
  );
  const onComposerLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      const height = event.nativeEvent.layout.height + 20;
      const grew = height !== measurements.current.composer;
      measurements.current.composer = height;
      composerHeight.set(height);
      // Build #102 (typing a long message moved the chat): a pinned chat keeps the end as the composer grows.
      if (grew && openingFollowNow.current && !scrolledUp.get())
        requestAnimationFrame(() => void listRef.current?.scrollToEnd({ animated: false }));
    },
    [composerHeight, scrolledUp],
  );
  /**
   * The rows from the latest user message to the end have their sizes, so the blank space under that
   * message is known. A sent message now moves to the top of the chat.
   */
  const onAnchorReady = useCallback(
    (info: AnchorReadyInfo) => {
      const send = pending.current;
      const list = listRef.current;
      if (!send || !list || info.anchorKey === undefined || info.anchorKey === send.baseline) return;
      pending.current = null;
      reveal();
      // From older messages the list jumps: a long animated scroll would render every row on the way.
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
          void listRef.current?.scrollToEnd({ animated: true });
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
      const userHeight = Math.max(0, list.getState().sizeAtIndex(info.anchorIndex) - CHAT_ROW_GAP);
      // The first message rises from the composer to its place under the header.
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
      header,
      keyboardHeight,
      keyboardMoving,
      keyboardOffset,
      reducedMotion,
      responseOpacity,
      reveal,
    ],
  );

  useAnimatedReaction(
    () =>
      revealed.get() &&
      chatContentIsVisible(
        content.get(),
        viewport.get(),
        scrollOffset.get(),
        composerHeight.get() + Math.max(0, keyboardHeight.get() - keyboardOffset),
      ),
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(updateAtLatest, visible);
    },
  );
  useAnimatedReaction(
    () => scrollOffset.get(),
    (y) => {
      if (!revealed.get() || scrolledUp.get()) return;
      // A status-bar tap or an assistive scroll moves the list up without a drag.
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
    // A sent message takes its own place in the list.
    setOpeningFollow(false);
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    const baseline = current.current.lastUserId;
    const first = baseline === null;
    pending.current = { baseline, first, fromLatest: atLatestNow.current };
    if (first) {
      firstOpacity.set(0);
      responseOpacity.set(0);
      setResponseVisible(false);
    }
  }, [firstOpacity, responseOpacity]);
  const cancelSend = useCallback(() => {
    pending.current = null;
    if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    sendScrollFrame.current = null;
    cancelAnimation(firstOffset);
    firstOffset.set(0);
    firstOpacity.set(1);
    responseOpacity.set(1);
    setResponseVisible(true);
  }, [firstOffset, firstOpacity, responseOpacity]);
  /** The reader, not the chat, now chooses the position. */
  const leaveLatest = useCallback(() => {
    openingFollowNow.current = false;
    setOpeningFollow(false);
    setUserScrolled(true);
    followLatest.current = false;
    setKeyboardLiftBehavior("never");
  }, []);
  const onScrollBeginDrag = useCallback(() => {
    // A drag is the reader's choice. A move of the list while rows get their sizes is not.
    openingFollowNow.current = false;
    setOpeningFollow(false);
    leaveLatest();
    reveal();
    cancelSend();
  }, [leaveLatest, reveal, cancelSend]);
  /** Opens the chat with row `index` under the header, instead of at the latest message. */
  const openAt = useCallback(
    (index: number): Promise<void> => {
      leaveLatest();
      const scrolled = listRef.current?.scrollToIndex({ index, viewOffset: header + FOCUS_GAP, animated: false });
      return (scrolled ?? Promise.resolve()).then(reveal, reveal);
    },
    [leaveLatest, header, reveal],
  );
  /** Positions the chat at the latest message again, after the latest page replaces a window around a searched message. */
  const returnToLatest = useCallback(() => {
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    setLatestGeneration((generation) => generation + 1);
  }, []);
  const onScrollEndDrag = useCallback(
    (event: { nativeEvent: Pick<NativeScrollEvent, "contentOffset"> }) => {
      // Only a user scroll can resume following. Keyboard dismissal can make the
      // reply visible without the user choosing to return to it.
      const m = measurements.current;
      followLatest.current = chatContentIsVisible(
        m.content,
        m.viewport,
        event.nativeEvent.contentOffset.y,
        m.composer + Math.max(0, keyboardHeight.get() - keyboardOffset),
      );
      setKeyboardLiftBehavior(followLatest.current ? "whenAtEnd" : "never");
    },
    [keyboardHeight, keyboardOffset],
  );
  const scrollToLatest = useCallback(() => {
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    void listRef.current?.scrollToEnd({ animated: !reducedMotion });
  }, [reducedMotion]);

  return useMemo(
    () => ({
      listRef,
      listPlaced,
      /** While a message from search opens the chat, the list does not take the latest message. */
      startsAtEnd: !holdOpening,
      atLatest,
      userScrolled,
      historyVisible,
      responseVisible,
      composerHeight,
      composerStyle,
      keyboardHeight,
      keyboardProgress,
      anticipateKeyboard,
      keyboardLiftBehavior,
      /**
       * The list keeps the latest message in view. A question waits for the reader at the end of the
       * chat while it grows, and an opening chat stays at the latest message until the reader drags.
       */
      followsEnd: (requiredInputId !== null && keyboardLiftBehavior === "whenAtEnd") || (openingFollow && !holdOpening),
      scrollOffset,
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
      openAt,
      returnToLatest,
      latestGeneration,
    }),
    [
      listPlaced,
      holdOpening,
      atLatest,
      userScrolled,
      historyVisible,
      responseVisible,
      composerHeight,
      composerStyle,
      keyboardHeight,
      keyboardProgress,
      anticipateKeyboard,
      keyboardLiftBehavior,
      requiredInputId,
      openingFollow,
      scrollOffset,
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
      openAt,
      returnToLatest,
      latestGeneration,
    ],
  );
}

export type ChatMotion = ReturnType<typeof useChatMotion>;
