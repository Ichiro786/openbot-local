import { BlurView } from "expo-blur";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Plus from "lucide-react-native/icons/plus";
import { type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { useUniwind } from "uniwind";
import { create } from "zustand";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { useBlurBudget } from "@/shared/glass/blurBudget";
import { GlintRim } from "@/shared/glass/GlintRim";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { currentFrostTarget } from "./frostTarget";
import { addChatBackListener } from "./predictiveBack";
import { menu } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

export type GlassMenuItem = {
  id: string;
  title: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
  /**
   * Build 10: a sub-menu. Choosing this row shows these rows in the same card (a back row on top),
   * as the HeroUI sub-menu did; the menu does not close.
   */
  children?: GlassMenuItem[];
};

/**
 * Build 10: the quick reactions of a message, drawn as a frosted bar over the card. "+" grows the
 * bar into the full emoji grid. A pick closes the menu and arrives in `onSelect` as
 * `reactionMenuId(emoji)` (`null` removes the reader's reaction), after the menu has unmounted.
 */
export type GlassReactions = {
  quick: readonly string[];
  all: readonly string[];
  /** The reader's own reaction, shown selected; picking it again removes it. */
  own: string | null;
  reactLabel: (emoji: string) => string;
  moreLabel: string;
};

export type GlassMenuAnchor = { x: number; y: number; width: number; height: number };
export type GlassMenuPauses = "composer" | "header";

type GlassMenuRequest = {
  key: number;
  /** The anchor in window coordinates (`measureInWindow`), or null to open in the middle. */
  anchor: GlassMenuAnchor | null;
  title?: string;
  items: GlassMenuItem[];
  /** Build 10: the reaction bar over the card (message long-press). */
  reactions?: GlassReactions;
  /** Build 10: a light dim behind the menu (message long-press). */
  dim?: boolean;
  /** Build 11: the rows arrive one after another, nearest the anchor first (composer + menu). */
  stagger?: boolean;
  /**
   * Build 11.1: always above the anchor, never flipped below (composer +: below it is the composer and
   * the keyboard, which the host's frame includes).
   */
  above?: boolean;
  /**
   * Build 15.1: which of the chat's two frosts a one-blur menu takes, so the screen stays at two blurs.
   * Default `composer` (menus at the top: thread menu, •••). The composer + menu takes the header band's
   * blur instead (its scrim stays), so the composer it opens from keeps its glass.
   */
  pauses?: GlassMenuPauses;
  /** Runs once, after the menu has closed and unmounted. */
  onSelect: (id: string) => void;
  /**
   * Runs once when the menu is gone. `chosen` is true when an action follows in `onSelect` (it runs
   * after the menu has unmounted and a frame has passed), so an opener can close after the action.
   */
  onClose: (chosen: boolean) => void;
};

const REACTION_PREFIX = "glass-reaction:";
/** The `onSelect` id of a reaction pick. An empty emoji removes the reader's reaction. */
export function reactionMenuId(emoji: string | null): string {
  return `${REACTION_PREFIX}${emoji ?? ""}`;
}
/** The reaction an `onSelect` id carries: an emoji, `null` for a removal, `undefined` for no reaction. */
export function reactionFromMenuId(id: string): string | null | undefined {
  if (!id.startsWith(REACTION_PREFIX)) return undefined;
  return id.slice(REACTION_PREFIX.length) || null;
}

const WIDTH = 224;
const PADDING = 8;
const SEPARATOR = 9;
const TITLE_HEIGHT = 30;
const EDGE = 12;
/** Frost: a 32 dp-ish blur of the target under a lighter tint than the solid card. */
const FROST_INTENSITY = 32;
const FROST_TINT_TOP = 0.56;
const FROST_TINT_BOTTOM = 0.8;
/** The longest a closing menu may stay mounted, whatever happens to its animation callback. */
const CLOSE_SAFETY_MS = 400;

function once<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let called = false;
  return (...args: A) => {
    if (called) return;
    called = true;
    fn(...args);
  };
}

const useGlassMenuStore = create<{ request: GlassMenuRequest | null; frosted: boolean }>(() => ({
  request: null,
  frosted: false,
}));
/** Build 10: whether an open glass menu frosts (draws at least one blur), for a screen's blur budget. */
export function useGlassMenuFrostOpen(): boolean {
  return useGlassMenuStore((s) => s.request !== null && s.frosted);
}

/** Build 15.1: whether an open frosted one-blur menu takes this chat frost's blur (`pauses`). */
export function useGlassMenuPauses(surface: GlassMenuPauses): boolean {
  return useGlassMenuStore((s) => s.request !== null && s.frosted && (s.request.pauses ?? "composer") === surface);
}

/** Whether an open glass menu draws two blurs (reaction bar + card), so a screen can pause its own. */
export function useGlassMenuDoubleFrost(): boolean {
  return useGlassMenuStore((s) => Boolean(s.request?.reactions) && s.frosted);
}

let nextKey = 1;
let hostMounted = false;
let hostBox: GlassMenuAnchor | null = null;
/**
 * Build 11: the host's frame in the window, for an opener that knows its place from the screen's
 * bottom edge (the composer +, whose Reanimated transforms `measureInWindow` cannot see).
 */
export function glassMenuHostBox(): GlassMenuAnchor | null {
  return hostMounted ? hostBox : null;
}
/** Keys of menus whose opener unmounted. */
const cancelled = new Set<number>();

/**
 * Opens the ColorOS glass menu in the app window (no RN Modal, no second window, nothing rendered in
 * the header). Returns the request key, or null when no host is mounted so the caller keeps its own
 * menu. A menu that is already open is replaced; its onClose runs first.
 */
export function openGlassMenu(request: Omit<GlassMenuRequest, "key">): number | null {
  if (!hostMounted) return null;
  const previous = useGlassMenuStore.getState().request;
  const key = nextKey++;
  // Each callback runs at most once, whichever path (choice, back, outside tap, replace, unmount) ends it.
  useGlassMenuStore.setState({
    request: { ...request, key, onClose: once(request.onClose), onSelect: once(request.onSelect) },
    // Build 11 (e2e: 4 live blurs on a message long-press): the screen's own blurs (header band,
    // composer) pause in the same commit that mounts the menu's, not one effect later.
    frosted: ANDROID_BLUR && currentFrostTarget() !== null,
  });
  previous?.onClose(false);
  return key;
}

/** Closes the menu with this key at once, without an action (its opener unmounted). */
export function closeGlassMenu(key: number): void {
  // Its opener is gone: an action that was chosen but has not run yet must not run either.
  cancelled.add(key);
  const request = useGlassMenuStore.getState().request;
  if (request?.key !== key) return;
  useGlassMenuStore.setState({ request: null });
  request.onClose(false);
}

/**
 * One host, a sibling after the navigator inside `ColorOSMotionRoot`, so the menu draws over every
 * screen, header and sheet of the app window and can frost a target inside the navigator.
 */
export function GlassMenuHost() {
  const request = useGlassMenuStore((s) => s.request);
  const host = useRef<ViewInstance>(null);
  // The host's own place in the window, so window-coordinate anchors map into it.
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    hostMounted = true;
    return () => {
      hostMounted = false;
      const open = useGlassMenuStore.getState().request;
      useGlassMenuStore.setState({ request: null });
      open?.onClose(false);
    };
  }, []);
  const onLayout = (_event: LayoutChangeEvent) => {
    host.current?.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        hostBox = { x, y, width, height };
        setBox(hostBox);
      }
    });
  };
  return (
    <View ref={host} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {request && box ? <GlassMenuOverlay key={request.key} request={request} box={box} /> : null}
    </View>
  );
}

/** A row of the level on screen: an item, or the back row of a sub-menu. */
type Entry = GlassMenuItem & { back?: boolean };
type Row = { top: number; index: number };

const BACK_ID = "glass-menu-back";
/** Reaction bar: one 48 dp slot (M3 touch target) per emoji and for "+", in a 56 dp capsule. */
const BAR_SLOT = 48;
const BAR_HEIGHT = 56;
const BAR_PAD = 4;
const BAR_GAP = 8;
const PICKER_COLUMNS = 6;
const PICKER_HEIGHT = 236;
const LEVEL_MS = 180;
const PICKER_MS = 200;
/** Strong ease-out for UI (Expo animation skill): no ease-in on anything the user watches. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Lays the rows out once, so a finger y maps to a row without measuring. */
function layout(items: Entry[], hasTitle: boolean) {
  const rows: Row[] = [];
  let y = PADDING + (hasTitle ? TITLE_HEIGHT : 0);
  items.forEach((item, index) => {
    if (item.separatorBefore && index > 0) y += SEPARATOR;
    rows.push({ top: y, index });
    y += menu.rowPitch;
  });
  return { rows, height: y + PADDING };
}

/** The items of the level at `path` (indices of the sub-menu rows chosen so far). */
function levelAt(items: GlassMenuItem[], path: number[]): { items: GlassMenuItem[]; parent: GlassMenuItem | null } {
  let level = items;
  let parent: GlassMenuItem | null = null;
  for (const index of path) {
    const next = level[index];
    if (!next?.children?.length) break;
    parent = next;
    level = next.children;
  }
  return { items: level, parent };
}

/**
 * The ColorOS 17 popup menu. It grows out of its anchor from 0.25 on a critically damped 1450/76
 * spring and is a 27 dp card: frosted (blur of the focused screen's target under a 0.56 → 0.80 tint)
 * where a target is registered, else the solid 0.70 → 0.92 tinted card of build 8. A highlight follows
 * the finger on a 700/50 spring with a selection tick per row change; the card leans ~7 dp toward the
 * finger and stretches up to 1.5%. Touch is the React Native responder of one layer over the card:
 * the JS thread decides the row, the UI thread only animates. Back and an outside tap close it. The
 * chosen action runs after the menu has unmounted, one action per open.
 *
 * Build 10: a sub-menu row shows its rows in the same card (they slide in, the card resizes, a back
 * row returns); a level taller than the room scrolls with a drag; a message menu carries a frosted
 * reaction bar over the card that grows into the emoji grid.
 */
function GlassMenuOverlay({
  request,
  box,
}: {
  request: GlassMenuRequest;
  box: { x: number; y: number; width: number; height: number };
}) {
  const { title, items, reactions } = request;
  const { reduceMotion } = useColorOSMotion();
  const { t } = useText();
  const dark = useUniwind().theme === "dark";
  const safe = useSafeAreaInsets();
  const gradientId = `glass-menu-${useId().replaceAll(":", "")}`;
  // Read once per open: the focused screen's target, only where Android draws the blur.
  const [frost] = useState<RefObject<ViewInstance | null> | null>(() => (ANDROID_BLUR ? currentFrostTarget() : null));
  useEffect(() => {
    useGlassMenuStore.setState({ frosted: Boolean(frost) });
    return () => useGlassMenuStore.setState({ frosted: false });
  }, [frost]);

  // The sub-menu on screen, and the rows of that level.
  const [path, setPath] = useState<number[]>([]);
  const level = useMemo(() => levelAt(items, path), [items, path]);
  const entries = useMemo<Entry[]>(
    () =>
      level.parent
        ? [
            { id: BACK_ID, title: level.parent.title, back: true },
            ...level.items.map((item, index) => ({ ...item, separatorBefore: index === 0 || item.separatorBefore })),
          ]
        : level.items,
    [level],
  );
  const hasTitle = Boolean(title) && path.length === 0;
  const laid = useMemo(() => layout(entries, hasTitle), [entries, hasTitle]);
  const rows = laid.rows;
  // A reaction-only menu (no rows) draws no card, only the bar.
  const cardShown = entries.length > 0;
  const naturalHeight = cardShown ? laid.height : 0;
  const [pickerOpen, setPickerOpen] = useState(false);

  // The anchor in host coordinates (a point in the middle when there is none).
  const anchor = useMemo(
    () =>
      request.anchor
        ? { ...request.anchor, x: request.anchor.x - box.x, y: request.anchor.y - box.y }
        : { x: box.width / 2, y: box.height / 2, width: 0, height: 0 },
    [request.anchor, box],
  );
  const barOffset = reactions ? BAR_HEIGHT + BAR_GAP : 0;
  const barWidth = reactions ? BAR_PAD * 2 + BAR_SLOT * (reactions.quick.length + 1) : 0;
  const groupWidth = Math.max(WIDTH, barWidth);
  // The side is chosen for the first level and kept, so a sub-menu never jumps to the other side.
  const side = useRef<boolean | null>(null);
  // Placement in host coordinates: below the anchor when it fits, else above; kept on screen. The
  // reaction bar sits over the card on both sides.
  const frame = useMemo(() => {
    const a = anchor;
    const below = box.height - safe.bottom - EDGE - (a.y + a.height + menu.anchorGap + barOffset);
    const above = a.y - safe.top - EDGE - menu.anchorGap - barOffset;
    if (side.current === null) side.current = !request.above && (below >= naturalHeight || below >= above);
    const placeBelow = side.current;
    const height = Math.max(cardShown ? menu.rowPitch : 0, Math.min(naturalHeight, placeBelow ? below : above));
    const alignRight = a.x + a.width / 2 > box.width / 2;
    const groupLeft = Math.max(
      EDGE,
      Math.min(box.width - groupWidth - EDGE, alignRight ? a.x + a.width - groupWidth : a.x),
    );
    const left = alignRight ? groupLeft + groupWidth - WIDTH : groupLeft;
    const barLeft = alignRight ? groupLeft + groupWidth - barWidth : groupLeft;
    const top = placeBelow ? a.y + a.height + menu.anchorGap + barOffset : a.y - menu.anchorGap - height;
    const originX = Math.max(0, Math.min(WIDTH, a.x + a.width / 2 - left));
    const originY = placeBelow ? -barOffset : height;
    return { left, top, height, originX, originY, barLeft, scrollable: naturalHeight > height };
  }, [anchor, box, safe.top, safe.bottom, naturalHeight, barOffset, groupWidth, barWidth, cardShown, request.above]);
  const barTop = frame.top - barOffset;
  // The emoji grid grows down from the bar's top, kept on screen.
  const pickerTop = Math.max(safe.top + EDGE, Math.min(barTop, box.height - safe.bottom - EDGE - PICKER_HEIGHT));

  const open = useSharedValue(reduceMotion ? 1 : menu.fromScale);
  const fade = useSharedValue(0);
  const highlightY = useSharedValue(-1);
  const highlightAlpha = useSharedValue(0);
  const lean = useSharedValue(0);
  const stretchY = useSharedValue(1);
  // A new level pops in from 0.97 (transform only; the card takes the level's size at once).
  const levelScale = useSharedValue(1);
  const scroll = useSharedValue(0);
  const levelIn = useSharedValue(1);
  const levelFrom = useSharedValue(0);
  const picker = useSharedValue(0);
  const activeRow = useSharedValue(-1);
  const closing = useRef(false);
  /** `closing` for the UI thread. */
  const closingNow = useSharedValue(false);
  const touchId = useSharedValue(-1);
  const dragOn = useSharedValue(false);
  const dragY0 = useSharedValue(0);
  const dragScroll0 = useSharedValue(0);
  const dragScrolling = useSharedValue(false);
  const done = useRef(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build 11.3 motion B7 (audit N18): the open starts in the commit that mounts the menu, not an
  // effect after its first paint.
  useLayoutEffect(() => {
    if (!reduceMotion) open.set(withSpring(1, menu.openSpring));
    fade.set(withTiming(1, { duration: menu.contentFadeInMs }));
    return () => {
      if (safety.current) clearTimeout(safety.current);
    };
  }, [reduceMotion, open, fade]);

  // A new level starts at the top of its rows.
  const resetScroll = () => {
    scroll.set(0);
  };

  useEffect(() => {
    picker.set(withTiming(pickerOpen ? 1 : 0, { duration: reduceMotion ? 0 : PICKER_MS, easing: EASE_OUT }));
  }, [pickerOpen, picker, reduceMotion]);

  // Once, from the fade callback or the safety timer: unmount, then run the action a frame later.
  const finish = (id: string | null) => {
    if (done.current) return;
    done.current = true;
    if (safety.current) clearTimeout(safety.current);
    const { onClose, onSelect, key } = request;
    if (useGlassMenuStore.getState().request?.key === key) useGlassMenuStore.setState({ request: null });
    onClose(id !== null);
    if (id === null) {
      cancelled.delete(key);
      return;
    }
    // Council D17: act two frames after the unmount (one for its commit to reach the screen), not
    // after a further 110 ms wait: the menu is already gone, so the wait only read as hesitation.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (cancelled.delete(key)) return;
        onSelect(id);
      }),
    );
  };

  const dismiss = (id: string | null) => {
    if (closing.current) return;
    closing.current = true;
    closingNow.set(true);
    safety.current = setTimeout(() => finish(id), CLOSE_SAFETY_MS);
    fade.set(
      withTiming(0, { duration: menu.closeMs, easing: Easing.in(Easing.quad) }, () => {
        runOnJS(finish)(id);
      }),
    );
    if (!reduceMotion) {
      // Build 11.3 batch 1 (F16): never grow on close. A menu dismissed while still opening (below
      // closeScale) keeps shrinking from where it is toward the scale it opened from.
      const now = open.get();
      const to = now > menu.closeScale ? menu.closeScale : Math.min(now, menu.fromScale);
      // Build 11.3 motion (F16 review note): the open's own spring, which takes over the running
      // spring's velocity, so a menu dismissed mid-open turns round without a kink (was a 90 ms timing).
      open.set(withSpring(to, menu.openSpring));
    }
  };

  const clearHighlight = () => {
    highlightAlpha.set(withTiming(0, { duration: 120 }));
    activeRow.set(-1);
  };

  // Into a sub-menu (index of its row), or back out of one (null).
  const goLevel = (index: number | null) => {
    if (closing.current) return;
    void haptics.selection();
    clearHighlight();
    highlightY.set(-1);
    levelFrom.set(index === null ? -1 : 1);
    levelIn.set(0);
    levelIn.set(withTiming(1, { duration: reduceMotion ? 0 : LEVEL_MS, easing: EASE_OUT }));
    if (!reduceMotion) {
      levelScale.set(0.97);
      levelScale.set(withTiming(1, { duration: LEVEL_MS, easing: EASE_OUT }));
    }
    resetScroll();
    setPath((current) => (index === null ? current.slice(0, -1) : [...current, index]));
  };

  const choose = (entry: Entry | undefined, index: number) => {
    if (!entry || entry.disabled) return;
    if (entry.back) {
      goLevel(null);
      return;
    }
    // The row's index in its level: the back row comes first in a sub-menu.
    if (entry.children?.length) {
      goLevel(level.parent ? index - 1 : index);
      return;
    }
    dismiss(entry.id);
  };

  // Back leaves the emoji grid, then a sub-menu, then closes the menu.
  const back = useRef(() => {});
  back.current = () => {
    if (pickerOpen) {
      setPickerOpen(false);
    } else if (path.length > 0) goLevel(null);
    else dismiss(null);
  };
  // Build 11.3 batch 1 (F04): a chat Back hold (once per menu, released on unmount), so the chat's
  // predictive callback is off while the menu shows and both hardware and predictive Back reach this
  // listener first. A listener only: it never holds the chat's removal.
  useEffect(() => {
    const subscription = addChatBackListener(() => {
      back.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const h = frame.height;
  // Build 11.3 motion B7 (audit F15): finger tracking runs on the UI thread (a manual RNGH gesture), so
  // the highlight, lean and stretch stay glued to the finger while JS is busy (streaming). JS hears only
  // a row change (the selection tick) and the release (the choice). Rows are mirrored into a shared
  // value. Every worklet helper below is declared before the gesture that calls it (repo rule).
  const touchRows = useSharedValue<{ top: number; index: number; disabled: boolean }[]>([]);
  useEffect(() => {
    touchRows.set(rows.map((row) => ({ top: row.top, index: row.index, disabled: !!entries[row.index]?.disabled })));
  }, [rows, entries, touchRows]);
  const scrollable = frame.scrollable;
  const maxScroll = naturalHeight - h;

  const rowAt = (y: number) => {
    "worklet";
    let found: { top: number; index: number; disabled: boolean } | null = null;
    for (const row of touchRows.get()) {
      if (y >= row.top && y < row.top + menu.rowPitch) found = row;
    }
    return found && !found.disabled ? found.index : -1;
  };

  const topOf = (index: number) => {
    "worklet";
    for (const row of touchRows.get()) {
      if (row.index === index) return row.top;
    }
    return 0;
  };

  const tick = () => void haptics.selection();

  const track = (y: number, first: boolean) => {
    "worklet";
    if (closingNow.get()) return;
    const index = rowAt(y + scroll.get());
    if (index !== activeRow.get()) {
      if (index >= 0 && !first) scheduleOnRN(tick);
      activeRow.set(index);
    }
    if (index >= 0) {
      const top = topOf(index);
      highlightY.set(first || highlightY.get() < 0 ? top : withSpring(top, menu.highlight.spring));
    }
    highlightAlpha.set(withTiming(index >= 0 ? 1 : 0, { duration: first ? 40 : 60 }));
    // A level that scrolls keeps still under the finger.
    if (reduceMotion || scrollable) return;
    lean.set(
      withSpring(Math.max(menu.lean.min, Math.min(menu.lean.max, (y - h / 2) * menu.lean.factor)), menu.lean.spring),
    );
    stretchY.set(withSpring(1 + menu.lean.maxStretch * Math.max(0, Math.min(1, y / h)), menu.lean.spring));
  };

  const settle = () => {
    "worklet";
    lean.set(withSpring(0, menu.lean.spring));
    stretchY.set(withSpring(1, menu.lean.spring));
  };

  const clearHighlightNow = () => {
    "worklet";
    highlightAlpha.set(withTiming(0, { duration: 120 }));
    activeRow.set(-1);
  };

  const released = (index: number) => {
    choose(entries[index], index);
    if (!closing.current) clearHighlight();
  };

  const grant = (y: number) => {
    "worklet";
    dragOn.set(true);
    dragY0.set(y);
    dragScroll0.set(scroll.get());
    dragScrolling.set(false);
    track(y, true);
  };

  const move = (y: number) => {
    "worklet";
    if (!dragOn.get()) return;
    if (scrollable && (dragScrolling.get() || Math.abs(y - dragY0.get()) > 8)) {
      if (!dragScrolling.get()) {
        dragScrolling.set(true);
        clearHighlightNow();
      }
      scroll.set(Math.max(0, Math.min(maxScroll, dragScroll0.get() - (y - dragY0.get()))));
      return;
    }
    track(y, false);
  };

  const release = (x: number, y: number) => {
    "worklet";
    if (!dragOn.get()) return;
    settle();
    const scrolled = dragScrolling.get();
    dragOn.set(false);
    const index = activeRow.get();
    const inside = x >= 0 && x <= WIDTH && y >= 0 && y <= h;
    if (!scrolled && inside && index >= 0) {
      scheduleOnRN(released, index);
      return;
    }
    clearHighlightNow();
  };

  const terminate = () => {
    "worklet";
    settle();
    dragOn.set(false);
    clearHighlightNow();
  };

  // One finger, the first down; the layer takes it at once, as the responder layer did.
  const touches = Gesture.Manual()
    .onTouchesDown((event, manager) => {
      "worklet";
      const touch = event.changedTouches[0];
      if (!touch || touchId.get() >= 0) return;
      manager.activate();
      touchId.set(touch.id);
      grant(touch.y);
    })
    .onTouchesMove((event) => {
      "worklet";
      const touch = event.allTouches.find((held) => held.id === touchId.get());
      if (touch) move(touch.y);
    })
    .onTouchesUp((event, manager) => {
      "worklet";
      const touch = event.changedTouches.find((lifted) => lifted.id === touchId.get());
      if (!touch) return;
      touchId.set(-1);
      manager.end();
      release(touch.x, touch.y);
    })
    .onTouchesCancelled((_event, manager) => {
      "worklet";
      touchId.set(-1);
      manager.end();
      terminate();
    });

  const card = useAnimatedStyle(() => ({
    opacity: fade.get() * (1 - picker.get()),
    transform: [{ translateY: lean.get() }, { scale: open.get() * levelScale.get() }, { scaleY: stretchY.get() }],
  }));
  const content = useAnimatedStyle(() => ({
    opacity: levelIn.get(),
    transform: [{ translateY: -scroll.get() }, { translateX: (1 - levelIn.get()) * 16 * levelFrom.get() }],
  }));
  const highlight = useAnimatedStyle(() => ({
    opacity: highlightAlpha.get(),
    transform: [{ translateY: highlightY.get() }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: fade.get() * 0.22 }));

  const tint = dark ? "22,22,22" : "248,248,248";
  const text = dark ? "#f2f2f2" : "#161616";
  const danger = dark ? "#ff6b6b" : "#d92d20";
  const tintTop = frost ? FROST_TINT_TOP : menu.tintTop;
  const tintBottom = frost ? FROST_TINT_BOTTOM : menu.tintBottom;
  const glass = { frost, dark, tint, tintTop, tintBottom, gradientId };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {request.dim ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      ) : null}
      <Pressable accessibilityLabel={t("common.close")} style={StyleSheet.absoluteFill} onPress={() => dismiss(null)} />
      {cardShown ? (
        <Animated.View
          accessibilityRole="menu"
          pointerEvents={pickerOpen ? "none" : "auto"}
          // Position and size are set here, not animated (build 9): a level change swaps the size at once
          // under an opacity/scale crossfade, and the height is the clip a long, scrolling level needs.
          style={[
            styles.card,
            { left: frame.left, top: frame.top, height: h, transformOrigin: [frame.originX, frame.originY, 0] },
            card,
          ]}
        >
          {/* The grid's blur replaces the card's and the bar's as soon as it mounts (they are fading out), so a
              message menu never runs more than two blurs. */}
          <GlassFill {...glass} frost={pickerOpen ? null : frost} width={WIDTH} height={h} radius={menu.radius} />
          <Animated.View style={[StyleSheet.absoluteFill, content]}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.highlight,
                { backgroundColor: dark ? menu.highlight.fill : "rgba(0,0,0,0.07)" },
                highlight,
              ]}
            />
            {hasTitle ? (
              <View pointerEvents="none" style={[styles.title, { top: PADDING }]}>
                <Typography.Paragraph type="body-xs" numberOfLines={1} style={{ color: text, opacity: 0.6 }}>
                  {title}
                </Typography.Paragraph>
              </View>
            ) : null}
            {entries.map((item, index) => {
              const row = rows[index];
              const color = item.destructive ? danger : text;
              return (
                // Full-size wrapper: a zero-size one hid the absolute rows from accessibility (Android
                // drops nodes outside their parent's bounds), so TalkBack and UI tests could not see them.
                <StaggerRow
                  key={`${path.join(".")}:${item.id}`}
                  open={open}
                  order={side.current === false ? entries.length - 1 - index : index}
                  below={side.current !== false}
                  on={Boolean(request.stagger) && !reduceMotion}
                >
                  {item.separatorBefore && index > 0 && row ? (
                    <View
                      style={[
                        styles.separator,
                        { top: row.top - SEPARATOR / 2 - 0.5, backgroundColor: dark ? "#ffffff1f" : "#0000001a" },
                      ]}
                    />
                  ) : null}
                  <View
                    accessible
                    accessibilityRole={item.back ? "button" : "menuitem"}
                    accessibilityLabel={item.back ? `${t("common.back")}, ${item.title}` : item.title}
                    accessibilityState={{ disabled: item.disabled, selected: item.selected }}
                    // TalkBack's double tap is an accessibility action, not a touch on the layer above.
                    accessibilityActions={[{ name: "activate" }]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === "activate") choose(item, index);
                    }}
                    style={[styles.row, { top: row?.top ?? 0, opacity: item.disabled ? 0.4 : 1 }]}
                  >
                    {item.back ? (
                      <View style={styles.icon}>
                        <ChevronLeft size={18} color={text} strokeWidth={2} />
                      </View>
                    ) : item.icon ? (
                      <View style={styles.icon}>{item.icon}</View>
                    ) : null}
                    <Typography.Paragraph
                      weight={item.back ? "semibold" : "medium"}
                      numberOfLines={1}
                      style={[styles.label, { color }]}
                    >
                      {item.title}
                    </Typography.Paragraph>
                    {item.selected ? <Check size={16} color={color} strokeWidth={2.2} /> : null}
                    {item.children?.length ? (
                      <ChevronRight size={16} color={text} strokeWidth={2} opacity={0.6} />
                    ) : null}
                  </View>
                </StaggerRow>
              );
            })}
          </Animated.View>
          {/* One touch layer over the card: its locations are in the card's own (untransformed) space. */}
          <GestureDetector gesture={touches}>
            <View collapsable={false} style={StyleSheet.absoluteFill} />
          </GestureDetector>
        </Animated.View>
      ) : null}
      {reactions ? (
        <ReactionBar
          reactions={reactions}
          glass={glass}
          left={frame.barLeft}
          top={barTop}
          pickerTop={pickerTop}
          width={barWidth}
          originX={Math.max(0, Math.min(barWidth, anchor.x + anchor.width / 2 - frame.barLeft))}
          originY={side.current ? 0 : BAR_HEIGHT + BAR_GAP + h}
          open={open}
          fade={fade}
          picker={picker}
          pickerOpen={pickerOpen}
          onOpenPicker={() => {
            if (closing.current) return;
            void haptics.selection();
            setPickerOpen(true);
          }}
          onPick={(emoji) => {
            void haptics.selection();
            dismiss(reactionMenuId(emoji === reactions.own ? null : emoji));
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * Build 11: a row's light entry on the menu's own open value (no timer of its own), so closing
 * reverses it. Full-size and untouchable like the plain wrapper; `on` false draws it as before.
 */
function StaggerRow({
  open,
  order,
  below,
  on,
  children,
}: {
  open: SharedValue<number>;
  order: number;
  below: boolean;
  on: boolean;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    if (!on) return { opacity: 1, transform: [{ translateY: 0 }] };
    const start = menu.stagger.start + order * menu.stagger.step;
    const arrived = interpolate(open.get(), [start, start + menu.stagger.span], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: arrived,
      transform: [{ translateY: (1 - arrived) * menu.stagger.rise * (below ? -1 : 1) }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}

type Glass = {
  frost: RefObject<ViewInstance | null> | null;
  dark: boolean;
  tint: string;
  tintTop: number;
  tintBottom: number;
  gradientId: string;
};

/** The card's glass: the frost blur (or the solid card), the tint gradient and, frosted, the rim. */
function GlassFill({
  frost,
  dark,
  tint,
  tintTop,
  tintBottom,
  gradientId,
  radius,
  suffix = "",
}: Glass & { width: number; height: number; radius: number; suffix?: string }) {
  const id = `${gradientId}${suffix}`;
  useBlurBudget(Boolean(frost), `glass-menu${suffix}`);
  return (
    <>
      {frost ? (
        // Frost: the BlurView lives outside the target (this host is a sibling after the navigator).
        <BlurView
          blurTarget={frost}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={FROST_INTENSITY}
          blurReductionFactor={4}
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        // Solid card (build 8) where no target is registered.
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgb(${tint})` }]} />
      )}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={`rgb(${tint})`} stopOpacity={tintTop} />
            <Stop offset="1" stopColor={`rgb(${tint})`} stopOpacity={tintBottom} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {/* Build 11: the edge glints of the shared glass (spec §1), in place of the drawn hairline. */}
      {frost ? <GlintRim radius={radius} dark={dark} lens={false} /> : null}
    </>
  );
}

/**
 * Build 10: the frosted reaction bar of a message menu. Five quick emojis and "+"; "+" crossfades the
 * bar into the emoji grid, a fixed-size glass panel that grows from the bar (opacity and scale only),
 * while the card under it fades out. It opens and closes with the card.
 */
function ReactionBar({
  reactions,
  glass,
  left,
  top,
  pickerTop,
  width,
  originX,
  originY,
  open,
  fade,
  picker,
  pickerOpen,
  onOpenPicker,
  onPick,
}: {
  reactions: GlassReactions;
  glass: Glass;
  left: number;
  top: number;
  pickerTop: number;
  width: number;
  originX: number;
  originY: number;
  open: SharedValue<number>;
  fade: SharedValue<number>;
  picker: SharedValue<number>;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onPick: (emoji: string) => void;
}) {
  const text = glass.dark ? "#f2f2f2" : "#161616";
  const selected = glass.dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.09)";
  const barStyle = useAnimatedStyle(() => ({
    opacity: fade.get() * (1 - picker.get()),
    transform: [{ scale: open.get() }],
  }));
  // The grid stays mounted until its fade-out ends, so leaving it is a crossfade as opening is.
  const [gridMounted, setGridMounted] = useState(pickerOpen);
  useEffect(() => {
    if (pickerOpen) {
      setGridMounted(true);
      return;
    }
    const timer = setTimeout(() => setGridMounted(false), PICKER_MS + 20);
    return () => clearTimeout(timer);
  }, [pickerOpen]);
  const gridStyle = useAnimatedStyle(() => ({
    opacity: fade.get() * picker.get(),
    transform: [{ scale: open.get() * (0.92 + 0.08 * picker.get()) }],
  }));
  const emojiButton = (emoji: string, size: number) => (
    <Pressable
      key={emoji}
      accessibilityRole="button"
      accessibilityLabel={reactions.reactLabel(emoji)}
      accessibilityState={{ selected: emoji === reactions.own }}
      onPress={() => onPick(emoji)}
      style={({ pressed }) => [
        styles.emoji,
        { width: size, height: size, borderRadius: size / 2 },
        emoji === reactions.own ? { backgroundColor: selected } : null,
        pressed ? styles.emojiPressed : null,
      ]}
    >
      <Text style={styles.emojiText}>{emoji}</Text>
    </Pressable>
  );
  return (
    <>
      <Animated.View
        pointerEvents={pickerOpen ? "none" : "auto"}
        style={[
          styles.bar,
          {
            left,
            top,
            width,
            height: BAR_HEIGHT,
            borderRadius: BAR_HEIGHT / 2,
            transformOrigin: [originX, originY, 0],
          },
          barStyle,
        ]}
      >
        <GlassFill
          {...glass}
          frost={pickerOpen ? null : glass.frost}
          width={width}
          height={BAR_HEIGHT}
          radius={BAR_HEIGHT / 2}
          suffix="-bar"
        />
        <View style={styles.quick}>
          {reactions.quick.map((emoji) => emojiButton(emoji, BAR_SLOT))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reactions.moreLabel}
            accessibilityState={{ expanded: pickerOpen }}
            onPress={onOpenPicker}
            style={({ pressed }) => [
              styles.emoji,
              { width: BAR_SLOT, height: BAR_SLOT, borderRadius: BAR_SLOT / 2 },
              pressed ? styles.emojiPressed : null,
            ]}
          >
            <Plus size={20} color={text} strokeWidth={2} />
          </Pressable>
        </View>
      </Animated.View>
      {gridMounted ? (
        <Animated.View
          accessibilityLabel={reactions.moreLabel}
          pointerEvents={pickerOpen ? "auto" : "none"}
          importantForAccessibility={pickerOpen ? "auto" : "no-hide-descendants"}
          style={[
            styles.bar,
            {
              left,
              top: pickerTop,
              width,
              height: PICKER_HEIGHT,
              borderRadius: menu.radius,
              transformOrigin: [originX, top - pickerTop + BAR_HEIGHT / 2, 0],
            },
            gridStyle,
          ]}
        >
          {/* Leaving, the grid fades out as solid glass: the card and the bar have their blurs back. */}
          <GlassFill
            {...glass}
            frost={pickerOpen ? glass.frost : null}
            width={width}
            height={PICKER_HEIGHT}
            radius={menu.radius}
            suffix="-grid"
          />
          <ScrollView
            style={{ height: PICKER_HEIGHT }}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {reactions.all.map((emoji) => emojiButton(emoji, (width - BAR_PAD * 2) / PICKER_COLUMNS))}
          </ScrollView>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: "#000" },
  card: {
    position: "absolute",
    width: WIDTH,
    borderRadius: menu.radius,
    borderCurve: "continuous",
    overflow: "hidden",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.28)",
  },
  bar: {
    position: "absolute",
    borderCurve: "continuous",
    overflow: "hidden",
    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.24)",
  },
  quick: { flexDirection: "row", alignItems: "center", height: BAR_HEIGHT, paddingHorizontal: BAR_PAD },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: BAR_PAD },
  emoji: { alignItems: "center", justifyContent: "center" },
  emojiPressed: { transform: [{ scale: 0.88 }] },
  emojiText: { fontSize: 26, lineHeight: 32 },
  highlight: {
    position: "absolute",
    left: menu.highlight.inset,
    right: menu.highlight.inset,
    top: 0,
    height: menu.rowPitch,
    borderRadius: menu.rowPitch / 2,
  },
  title: { position: "absolute", left: 18, right: 18, height: TITLE_HEIGHT, justifyContent: "center" },
  separator: { position: "absolute", left: 16, right: 16, height: StyleSheet.hairlineWidth },
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    height: menu.rowPitch,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  icon: { width: 18, alignItems: "center" },
  label: { flex: 1, fontSize: 15 },
});
