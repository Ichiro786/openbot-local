import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../model/chat-messages";
import { isStreamingReply } from "../model/reply-reveal";

/** Combine streamed revisions in one frame; new rows and finished replies show at once. */
export function useStreamedMessages(key: string, messages: ChatMessage[], enabled: boolean): ChatMessage[] {
  const [shown, setShown] = useState({ key, messages });
  const latest = useRef({ key, messages });
  const frame = useRef<number | null>(null);
  const wasEnabled = useRef(enabled);
  const streaming = enabled && messages.some(isStreamingReply);
  const sameRows =
    shown.key === key &&
    shown.messages.length === messages.length &&
    shown.messages.at(-1)?.id === messages.at(-1)?.id;

  useLayoutEffect(() => {
    latest.current = { key, messages };
    const starting = enabled && !wasEnabled.current;
    wasEnabled.current = enabled;
    if (!enabled || starting || !streaming || !sameRows) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (!enabled) return;
      setShown((previous) => (previous.key === key && previous.messages === messages ? previous : { key, messages }));
      return;
    }
    if (shown.messages === messages || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setShown(latest.current);
    });
  }, [key, messages, enabled, streaming, sameRows, shown.messages]);

  useLayoutEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return wasEnabled.current && streaming && sameRows ? shown.messages : messages;
}
