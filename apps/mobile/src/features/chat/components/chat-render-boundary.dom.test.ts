import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatRenderBoundary } from "./chat-render-boundary";

// A message part that throws, as an openbot-ui renderer did on bad input.
function Part({ text }: { text: string }): ReactNode {
  if (text.includes("BAD")) throw new Error(`cannot render ${text}`);
  return createElement("p", null, `rendered ${text}`);
}

function message(text: string, guarded: boolean, index: number) {
  const part = createElement(Part, { text });
  return guarded
    ? createElement(
        ChatRenderBoundary,
        { key: index, resetKey: text, fallback: createElement("pre", null, text) },
        part,
      )
    : createElement(Fragment, { key: index }, part);
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let uncaught: unknown[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  container = document.createElement("div");
  uncaught = [];
  root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) });
});
afterEach(() => act(() => root.unmount()));

const render = (texts: string[], guarded: boolean) =>
  act(() => root.render(createElement("div", null, ...texts.map((text, index) => message(text, guarded, index)))));

test("without a boundary one bad message blanks the whole chat (the old behaviour)", async () => {
  await render(["first", "last"], false);
  expect(container.textContent).toBe("rendered firstrendered last");
  // act() rethrows the uncaught render error; by then the root has unmounted every message.
  try {
    await render(["first", "BAD block", "last"], false);
  } catch (error) {
    uncaught.push(error);
  }
  expect(String(uncaught[0])).toContain("cannot render BAD block");
  expect(container.textContent).toBe("");
});

test("a bad message shows its raw text and every other message stays", async () => {
  await render(["first", "BAD block", "last"], true);
  expect(uncaught).toEqual([]);
  expect(container.textContent).toBe("rendered firstBAD blockrendered last");
});

test("a new text (a reply still streaming) renders the part again", async () => {
  await render(["first", "BAD partial"], true);
  expect(container.textContent).toBe("rendered firstBAD partial");
  await render(["first", "fixed"], true);
  expect(container.textContent).toBe("rendered firstrendered fixed");
});

test("the same text keeps the fallback (no render loop)", async () => {
  await render(["BAD again"], true);
  await render(["BAD again"], true);
  expect(container.textContent).toBe("BAD again");
});
