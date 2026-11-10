// Copied only into the E2E APK by apply-layout-harness.mjs.
import type { LegendListRef } from "@legendapp/list/react-native";
import { useCallback, useLayoutEffect, useRef } from "react";
import { type SharedValue, useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

declare global {
  var __e2eLongReset: (() => void) | undefined;
  var __e2eTap: number | undefined;
}

interface MotionSample {
  uiOffset: number;
  uiContent: number;
  uiViewport: number;
  composer: number;
  keyboard: number;
  keyboardProgress: number;
  revealed: boolean;
  scrolledUp: boolean;
}

interface LayoutEventPayload extends Partial<MotionSample> {
  visit?: number;
  name?: string;
  agentId?: string;
  agent?: string;
  colorOS?: boolean;
  mode?: string;
  generation?: number;
  count?: number;
  first?: number;
  last?: number;
  offset?: number;
  viewport?: number;
  content?: number;
  atEnd?: boolean;
  endReached?: boolean;
  tailMeasured?: boolean;
  latestVisible?: boolean;
  signal?: "isAtEnd" | "anchoredEndSpaceSize" | "lastPositionUpdate" | "totalSize" | "readyToRender";
  value?: number | boolean;
  bottom?: number;
  animated?: boolean;
  withRows?: boolean;
  height?: number;
  progress?: number;
  duration?: number;
  phase?: string;
  ready?: boolean;
  catchingUp?: boolean;
  historyVisible?: boolean;
  atLatest?: boolean;
  allRows?: boolean;
  visible?: boolean;
}

let visit = 0;
export function layoutEvent(event: string, data: LayoutEventPayload = {}) {
  if (event === "open") visit += 1;
  console.log(`E2ELAYOUT ${JSON.stringify({ event, visit, at: Date.now(), ...data })}`);
}

export function captureLayoutEvents() {
  const captured = visit;
  return (event: string, data: LayoutEventPayload = {}) => layoutEvent(event, { ...data, visit: captured });
}

export function useScopedLayoutEvent() {
  return useRef(captureLayoutEvents()).current;
}

export function useLayoutEvents(
  listRef: { current: LegendListRef | null },
  values: { [K in keyof MotionSample]: SharedValue<MotionSample[K]> },
) {
  const emit = useScopedLayoutEvent();
  const last = useRef("");
  const sample = useCallback(
    (event: string, data: LayoutEventPayload = {}) => {
      const state = listRef.current?.getState();
      const tail = state ? state.data.length - 1 : -1;
      emit(event, {
        ...data,
        ...(state
          ? {
              count: state.data.length,
              first: state.start,
              last: state.end,
              offset: state.scroll,
              viewport: state.scrollLength,
              content: state.contentLength,
              atEnd: state.isAtEnd,
              endReached: state.isEndReached,
              tailMeasured: tail >= 0 && state.sizeAtIndex(tail) > 0,
              latestVisible: tail >= 0 && state.start <= tail && state.end >= tail,
            }
          : {}),
      });
    },
    [emit, listRef],
  );
  useAnimatedReaction(
    () => ({
      uiOffset: values.uiOffset.get(),
      uiContent: values.uiContent.get(),
      uiViewport: values.uiViewport.get(),
      composer: values.composer.get(),
      keyboard: values.keyboard.get(),
      keyboardProgress: values.keyboardProgress.get(),
      revealed: values.revealed.get(),
      scrolledUp: values.scrolledUp.get(),
    }),
    (current, previous) => {
      if (JSON.stringify(current) !== JSON.stringify(previous)) scheduleOnRN(sample, "motion", current);
    },
  );
  useLayoutEffect(() => {
    const state = listRef.current?.getState();
    if (!state) return;
    const listeners = (
      ["isAtEnd", "anchoredEndSpaceSize", "lastPositionUpdate", "totalSize", "readyToRender"] as const
    ).map((signal) => state.listen(signal, (value) => sample("legend", { signal, value })));
    const list = listRef.current;
    if (!list) return;
    const original = list.scrollToEnd;
    const originalInset = list.reportContentInset;
    list.reportContentInset = (inset) => {
      originalInset(inset);
      sample("native-inset", { bottom: inset?.bottom ?? 0 });
    };
    list.scrollToEnd = (options) => {
      sample("scroll-command", { animated: options?.animated ?? false });
      return original(options).then(() => sample("scroll-resolved"));
    };
    const key = `${state.data.length}:${state.start}:${state.end}`;
    if (key !== last.current) {
      last.current = key;
      sample("commit");
    }
    return () => {
      for (const dispose of listeners) dispose();
      list.scrollToEnd = original;
      list.reportContentInset = originalInset;
    };
  });
}
