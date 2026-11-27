import { useEffect, useRef, useState } from "react";
import type { createReplyReveal } from "../model/reply-reveal";
import { REPLY_FLUSH_AFTER_MS, replyFlushes, replyWordFeedback } from "../model/reply-reveal";

const PLAYBACK_TICK_MS = 50;
const PLAYBACK_STEPS = 8;
const REPLY_DRAIN_MS = 350;

export interface ReplyPlayback {
  progress: Map<string, number>;
  id: string;
  enabled: boolean;
  active: boolean;
  paused: boolean;
  revealed: boolean;
  complete: boolean;
  onWord: (word: string, index: number) => void;
  onFlush: () => void;
  onComplete: (drained: boolean) => void;
  onPlaying: (playing: boolean) => void;
}

function resumable(playback: ReplyPlayback | undefined, total: number) {
  if (!playback?.revealed) return false;
  const position = playback.progress.get(playback.id) ?? 0;
  return position > 0 && position < total;
}

export function useReplyPlayback(plan: ReturnType<typeof createReplyReveal>, playback?: ReplyPlayback) {
  const unfinished = resumable(playback, plan.words.length);
  const [resumed, setResumed] = useState(false);
  const [flushed, setFlushed] = useState(false);
  const enabled = Boolean(playback?.enabled || (playback?.active && (unfinished || resumed)));
  const held = !enabled && Boolean(playback?.paused) && unfinished;
  const [visible, setVisible] = useState(() =>
    playback && (enabled || held) ? (playback.progress.get(playback.id) ?? 0) : plan.words.length,
  );
  const callbacks = useRef(playback);
  const currentPlan = useRef(plan);
  const wake = useRef(() => {});
  useEffect(() => {
    callbacks.current = playback;
    currentPlan.current = plan;
  }, [playback, plan]);
  const active = Boolean(playback?.active);
  useEffect(() => {
    if (active && unfinished) setResumed(true);
  }, [active, unfinished]);
  const id = playback?.id;
  const progress = playback?.progress;
  const complete = playback?.complete ?? false;
  const wordCount = plan.words.length;
  useEffect(() => {
    if (enabled || held) return;
    setVisible(wordCount);
    if (id && progress) progress.set(id, wordCount);
  }, [enabled, held, id, progress, wordCount]);
  useEffect(() => {
    if (!enabled || !id || !progress) {
      return;
    }
    const key = id;
    const store = progress;
    let position = store.get(key) ?? 0;
    let played = false;
    let done = false;
    let drainUntil: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const schedule = () => {
      if (!done && timer === undefined) timer = setTimeout(tick, PLAYBACK_TICK_MS);
    };
    const finish = () => {
      done = true;
      const drained = drainUntil !== null;
      if (drained) setFlushed(true);
      callbacks.current?.onPlaying(false);
      if (played) callbacks.current?.onComplete(drained);
      setResumed(false);
    };
    const tick = () => {
      timer = undefined;
      const words = currentPlan.current.words;
      const finishing = callbacks.current?.complete ?? false;
      const now = Date.now();
      if (drainUntil === null && finishing && now - started >= REPLY_FLUSH_AFTER_MS && replyFlushes(words, position)) {
        drainUntil = now + REPLY_DRAIN_MS;
        played = true;
        callbacks.current?.onFlush();
      }
      const backlog = words.length - position;
      if (backlog <= 0) {
        if (finishing) finish();
        return;
      }
      const ticksLeft = drainUntil === null ? PLAYBACK_STEPS : Math.ceil((drainUntil - now) / PLAYBACK_TICK_MS);
      const from = position;
      position += Math.ceil(backlog / Math.max(1, ticksLeft));
      played = true;
      store.set(key, position);
      setVisible(position);
      if (drainUntil === null) {
        let boundary = false;
        for (let index = from; index < position; index += 1) {
          const word = words[index];
          if (word === undefined || replyWordFeedback(word, index) !== "light") continue;
          boundary = true;
          callbacks.current?.onWord(word, index);
        }
        const last = words[position - 1];
        if (!boundary && last !== undefined) callbacks.current?.onWord(last, position - 1);
      }
      schedule();
    };
    callbacks.current?.onPlaying(true);
    wake.current = schedule;
    schedule();
    return () => {
      wake.current = () => {};
      if (timer !== undefined) clearTimeout(timer);
      if (!done) callbacks.current?.onPlaying(false);
    };
  }, [enabled, id, progress]);
  useEffect(() => {
    if (wordCount > 0 || complete) wake.current();
  }, [wordCount, complete]);
  return { tokens: enabled || held ? plan.at(visible) : plan.at(wordCount), playing: enabled && !flushed, flushed };
}
