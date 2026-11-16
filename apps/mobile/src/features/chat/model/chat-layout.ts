/**
 * How far the end of the content lies below what shows above the composer and the keyboard. Zero or less:
 * the end is in view.
 */
export function chatContentHiddenBy(content: number, viewport: number, scrollY: number, obstruction: number): number {
  "worklet";
  // Blank space is not unread content. Only the keyboard and composer obscure messages.
  return content - (scrollY + viewport - obstruction);
}

/** Whether the end of the content shows above the composer and the keyboard. */
export function chatContentIsVisible(content: number, viewport: number, scrollY: number, obstruction: number): boolean {
  "worklet";
  return chatContentHiddenBy(content, viewport, scrollY, obstruction) <= 2;
}

/**
 * Build 16.1 (Syed: the scroll-to-latest arrow showed while the chat sat at the latest message): the
 * arrow is for a reader who is really above the latest message, more than this far. A list that is a
 * frame behind the keyboard or the composer, or a row still settling, stays under it.
 */
export const LATEST_BUTTON_SLACK = 64;

/** Where the chat is against its latest message: at it, a little above it, or away from it. */
export type ChatLatestPlace = "latest" | "near" | "away";

/**
 * The place for content `hidden` (from `chatContentHiddenBy`). Null while it must not change: before the
 * rows show, and while the keyboard moves, when the keyboard, the composer and the list each move on
 * their own frames and a reading between them is not a place the reader chose.
 */
export function chatLatestPlace(hidden: number, revealed: boolean, keyboardMoving: boolean): ChatLatestPlace | null {
  "worklet";
  if (!revealed || keyboardMoving) return null;
  if (hidden <= 2) return "latest";
  return hidden > LATEST_BUTTON_SLACK ? "away" : "near";
}

/**
 * Whether the chat shows the scroll-to-latest arrow. Never while the chat itself keeps the end in view
 * (the opening follow, the arrow's own pin, a question) and the reader has not scrolled away.
 */
export function chatShowsLatestButton(input: {
  place: ChatLatestPlace;
  detached: boolean;
  followsEnd: boolean;
  userScrolled: boolean;
}): boolean {
  if (input.detached) return true;
  if (input.followsEnd && !input.userScrolled) return false;
  return input.place === "away";
}
