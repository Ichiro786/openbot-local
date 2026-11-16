import { describe, expect, it } from "vitest";
import {
  chatContentHiddenBy,
  chatContentIsVisible,
  chatLatestPlace,
  chatShowsLatestButton,
  LATEST_BUTTON_SLACK,
} from "./chat-layout";

// A chat 800 dp tall, composer 90 dp, keyboard 300 dp over a 0 dp offset: the end shows when the list
// scrolled to content - viewport + obstruction.
const viewport = 800;
const content = 2000;
const composer = 90;
const keyboard = 300;
const endWith = (obstruction: number) => content - viewport + obstruction;

describe("chat at-latest reading (build 16.1)", () => {
  it("keeps upstream's 2 dp rule for atLatest", () => {
    expect(chatContentIsVisible(content, viewport, endWith(composer), composer)).toBe(true);
    expect(chatContentIsVisible(content, viewport, endWith(composer) - 2, composer)).toBe(true);
    expect(chatContentIsVisible(content, viewport, endWith(composer) - 3, composer)).toBe(false);
  });

  it("measures how far the end is under the composer and keyboard", () => {
    expect(chatContentHiddenBy(content, viewport, endWith(composer), composer)).toBe(0);
    // Blank space under the latest message (scrolled past the end) is not hidden content.
    expect(chatContentHiddenBy(content, viewport, endWith(composer) + 400, composer)).toBe(-400);
  });

  it("a list one keyboard frame behind (old: arrow flash) is not 'away' once the keyboard is still", () => {
    // The keyboard rose 90 dp this frame and the list's scroll arrives next frame.
    const hidden = chatContentHiddenBy(content, viewport, endWith(composer + 200), composer + 290);
    expect(chatContentIsVisible(content, viewport, endWith(composer + 200), composer + 290)).toBe(false);
    // While the keyboard moves the place is not read at all.
    expect(chatLatestPlace(hidden, true, true)).toBeNull();
    // A late last frame of a few dp stays under the slack.
    expect(
      chatLatestPlace(
        chatContentHiddenBy(content, viewport, endWith(composer + keyboard) - 6, composer + keyboard),
        true,
        false,
      ),
    ).toBe("near");
  });

  it("reads nothing before the rows show (the arrow waits for the placed list)", () => {
    expect(chatLatestPlace(5000, false, false)).toBeNull();
  });

  it("is away only past the slack", () => {
    expect(chatLatestPlace(0, true, false)).toBe("latest");
    expect(chatLatestPlace(2, true, false)).toBe("latest");
    expect(chatLatestPlace(LATEST_BUTTON_SLACK, true, false)).toBe("near");
    expect(chatLatestPlace(LATEST_BUTTON_SLACK + 1, true, false)).toBe("away");
  });

  it("shows the arrow only for a reader away from the latest message", () => {
    const base = { detached: false, followsEnd: false, userScrolled: true };
    expect(chatShowsLatestButton({ ...base, place: "away" })).toBe(true);
    expect(chatShowsLatestButton({ ...base, place: "near" })).toBe(false);
    expect(chatShowsLatestButton({ ...base, place: "latest" })).toBe(false);
    // The opening follow keeps the end: no arrow while the reader has not scrolled (open-at-latest).
    expect(chatShowsLatestButton({ place: "away", detached: false, followsEnd: true, userScrolled: false })).toBe(
      false,
    );
    // A reader who scrolled up out of the follow gets it.
    expect(chatShowsLatestButton({ place: "away", detached: false, followsEnd: true, userScrolled: true })).toBe(true);
    // A window around a searched message always offers the way back.
    expect(chatShowsLatestButton({ place: "latest", detached: true, followsEnd: false, userScrolled: false })).toBe(
      true,
    );
  });
});
