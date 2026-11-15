// Build 15.3 audit: a whole reply the shape of Syed's blank chat (2026-11-16): a bold summary, a bar
// chart block, text, a table block, a rule, a heading and a long tail, read the way the chat reads it,
// streamed in chunks and then finished (reopened).
import type { Token, Tokens } from "marked";
import { describe, expect, it } from "vitest";
import { parseFinishedChatMarkdown, parseStreamingChatMarkdown } from "../model/chat-markdown-parser";
import { createReplyReveal } from "../model/reply-reveal";
import { fenceClosed, parseOpenbotUi, TABLE_COLUMN_MIN, tableFits } from "./openbot-ui-schema";

const CHART = JSON.stringify({
  type: "chart",
  kind: "bar",
  title: "Benchmarks",
  labels: ["SWE-bench Verified", "LiveCodeBench", "GPQA Diamond"],
  series: [
    { name: "Qwen 3.8 Flash", values: [61.2, 70.4, 71.8] },
    { name: "Gemini Hydrogen", values: [68.9, 74.1, 79.3] },
  ],
});
const TABLE = JSON.stringify({
  type: "table",
  columns: ["Specification", "Qwen 3.8 Flash", "Gemini Hydrogen"],
  rows: [
    ["Developer", "Alibaba (Qwen Team)", "Google DeepMind"],
    ["Pricing (Input / 1M)", "$0.15", "$1.25"],
    ["Pricing (Output / 1M)", "$0.47", "$5.00"],
    ["Context Window", "1M tokens", "1M tokens"],
    ["Architecture", "Open-weight MoE (120B total / 6B active)", "Proprietary"],
    ["Supported Modalities", "Text, Image", "Text, Image, Audio, Video"],
  ],
});
const TAIL = Array.from(
  { length: 40 },
  (_, i) => `- **Feature ${i + 1}:** ${"long comparison text about agentic coding, tool use and latency ".repeat(3)}`,
).join("\n");
const SYED_REPLY = [
  "**Gemini 4 Hydrogen leads on reasoning depth and autonomous software engineering, while Qwen 3.8 Flash delivers near-frontier performance at roughly one-tenth the cost with open-weight flexibility.**",
  "",
  "Here is the benchmark comparison across software engineering, coding synthesis, and scientific reasoning:",
  "",
  "```openbot-ui",
  CHART,
  "```",
  "",
  "Below are the architectural, operational, and pricing specifications for both models:",
  "",
  "```openbot-ui",
  TABLE,
  "```",
  "",
  "---",
  "",
  "## Feature Breakdown",
  "",
  TAIL,
  "",
  "TAIL-END",
].join("\n");

const uiTokens = (tokens: readonly Token[]) =>
  tokens.filter(
    (token): token is Tokens.Code => token.type === "code" && "lang" in token && token.lang === "openbot-ui",
  );

describe("a long reply with openbot-ui blocks (Syed's blank chat shape)", () => {
  it("parses finished: both blocks valid, and every block after them is still there", () => {
    const tokens = parseFinishedChatMarkdown(SYED_REPLY);
    const ui = uiTokens(tokens);
    expect(ui).toHaveLength(2);
    for (const token of ui) {
      expect(fenceClosed(token.raw)).toBe(true);
      expect(parseOpenbotUi(token.text).ok).toBe(true);
    }
    const types = tokens.filter((token) => token.type !== "space").map((token) => token.type);
    expect(types).toEqual([
      "paragraph",
      "paragraph",
      "code",
      "paragraph",
      "code",
      "hr",
      "heading",
      "list",
      "paragraph",
    ]);
    expect(tokens.map((token) => token.raw).join("")).toBe(SYED_REPLY);
    // The reveal counts each block as one word and keeps the tail.
    const reveal = createReplyReveal(tokens);
    expect(reveal.words.at(-1)).toBe("TAIL-END");
    expect(reveal.at(reveal.words.length)).toBe(tokens);
  });

  it("streams in chunks: a block is drawn only once its fence closes, and nothing after it is lost", () => {
    let seenTail = false;
    for (let end = 1; end <= SYED_REPLY.length; end += 37) {
      const body = SYED_REPLY.slice(0, end);
      const tokens = parseStreamingChatMarkdown(body);
      // The chunked parse reads the same blocks as a full parse of that prefix.
      const kinds = (list: readonly Token[]) =>
        list.filter((token) => token.type !== "space").map((token) => token.type);
      expect(kinds(tokens)).toEqual(kinds(parseFinishedChatMarkdown(body)));
      for (const token of uiTokens(tokens)) {
        // complete = fenceClosed while streaming; a closed block always validates here.
        if (fenceClosed(token.raw)) expect(parseOpenbotUi(token.text).ok).toBe(true);
      }
      seenTail ||= tokens.some((token) => token.type === "heading");
    }
    expect(seenTail).toBe(true);
    const done = parseStreamingChatMarkdown(SYED_REPLY);
    expect(uiTokens(done).every((token) => fenceClosed(token.raw))).toBe(true);
  });

  it("an unclosed block at the end of a finished reply is shown as code, not lost", () => {
    const cut = SYED_REPLY.slice(0, SYED_REPLY.indexOf(TABLE) + 40);
    const tokens = parseFinishedChatMarkdown(cut);
    const last = uiTokens(tokens).at(-1);
    expect(last && fenceClosed(last.raw)).toBe(false);
    // finished => complete, so the block parses (and fails) instead of waiting forever as a skeleton.
    expect(last && parseOpenbotUi(last.text).ok).toBe(false);
  });

  it("broken, unknown, CRLF and tilde blocks fall back or parse, never throw", () => {
    const bodies = [
      "```openbot-ui\n{not json\n```",
      '```openbot-ui\n{"type":"carousel","items":[]}\n```',
      '```openbot-ui\r\n{"type":"progress","value":0.5}\r\n```\r\n',
      '~~~openbot-ui\n{"type":"progress","value":0.5}\n~~~',
      '````openbot-ui\n{"type":"callout","tone":"info","body":"has ``` inside"}\n````',
      '```openbot-ui\n{"type":"callout","tone":"info","body":"a ``` mid-line does not close the fence"}\n```',
    ];
    const results = bodies.map((body) => {
      const token = uiTokens(parseFinishedChatMarkdown(body))[0];
      return token ? [fenceClosed(token.raw), parseOpenbotUi(token.text).ok] : null;
    });
    expect(results).toEqual([
      [true, false],
      [true, false],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
  });
});

describe("tableFits", () => {
  it("wraps a 3-column table on a phone card and scrolls an 8-column one", () => {
    // Syed's card (~316 dp wide): before 15.3 it clipped "Gemini Hydrogen" and "$1.25" at the right edge.
    expect(tableFits(3, 316)).toBe(true);
    expect(tableFits(8, 316)).toBe(false);
    expect(tableFits(3, 3 * TABLE_COLUMN_MIN + 23)).toBe(false);
    expect(tableFits(3, 3 * TABLE_COLUMN_MIN + 24)).toBe(true);
    expect(tableFits(1, 0)).toBe(false);
  });
});
