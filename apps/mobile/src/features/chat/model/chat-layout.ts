export function chatContentHiddenBy(content: number, viewport: number, scrollY: number, obstruction: number): number {
  "worklet";
  return content - (scrollY + viewport - obstruction);
}

export function chatContentIsVisible(content: number, viewport: number, scrollY: number, obstruction: number): boolean {
  "worklet";
  return chatContentHiddenBy(content, viewport, scrollY, obstruction) <= 2;
}

export const LATEST_BUTTON_SLACK = 64;

export type ChatLatestPlace = "latest" | "near" | "away";

export function chatLatestPlace(hidden: number, revealed: boolean, keyboardMoving: boolean): ChatLatestPlace | null {
  "worklet";
  if (!revealed || keyboardMoving) return null;
  if (hidden <= 2) return "latest";
  return hidden > LATEST_BUTTON_SLACK ? "away" : "near";
}

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
