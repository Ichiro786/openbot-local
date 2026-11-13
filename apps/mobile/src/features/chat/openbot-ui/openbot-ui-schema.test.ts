import { describe, expect, it } from "vitest";
import {
  estimateOpenbotUiHeight,
  fenceClosed,
  formValues,
  OPENBOT_UI_LIMITS,
  openbotUiActionMessage,
  parseOpenbotUi,
  type UiFormField,
} from "./openbot-ui-schema";

describe("parseOpenbotUi", () => {
  it("reads one node, an array, and JSONL", () => {
    const one = parseOpenbotUi('{"type":"progress","value":0.4,"label":"Upload"}');
    expect(one).toEqual({ ok: true, nodes: [{ type: "progress", value: 0.4, label: "Upload" }] });
    const array = parseOpenbotUi('[{"type":"callout","tone":"info","body":"Hi"},{"type":"progress","value":1}]');
    expect(array.ok && array.nodes.length).toBe(2);
    const lines = parseOpenbotUi('{"type":"callout","tone":"info","body":"Hi"}\n\n{"type":"progress","value":1}\n');
    expect(lines.ok && lines.nodes.map((n) => n.type)).toEqual(["callout", "progress"]);
  });

  it("accepts the whole v1 catalog", () => {
    const block = [
      { type: "card", title: "Trip", subtitle: "3 days", body: "**Lisbon**", image: "https://example.com/a.jpg" },
      { type: "stats", items: [{ label: "Cost", value: "€420", delta: "-8%", tone: "positive" }] },
      {
        type: "table",
        columns: ["A", "B"],
        rows: [
          ["x", 1],
          ["y", null],
        ],
      },
      { type: "chart", kind: "bar", labels: ["Mon", "Tue"], series: [{ name: "Runs", values: [3, 5] }] },
      { type: "chart", kind: "donut", labels: ["A", "B"], series: [{ name: "Share", values: [1, 2] }] },
      { type: "list", items: [{ icon: "star", title: "One", trailing: "5" }] },
      { type: "actions", style: "chips", items: [{ id: "pick", label: "Yes", value: "yes" }] },
      {
        type: "form",
        id: "signup",
        fields: [
          { name: "name", label: "Name", kind: "text", required: true },
          { name: "size", label: "Size", kind: "select", options: ["S", "M"] },
          { name: "n", label: "Count", kind: "number" },
          { name: "ok", label: "Agree", kind: "toggle" },
        ],
      },
      {
        type: "steps",
        items: [
          { label: "Build", status: "done" },
          { label: "Test", status: "active" },
        ],
      },
      { type: "callout", tone: "warning", title: "Heads up", body: "Check this" },
    ];
    const result = parseOpenbotUi(JSON.stringify(block));
    expect(result.ok).toBe(true);
  });

  it("rejects unknown types, unknown fields, http pictures and broken JSON", () => {
    expect(parseOpenbotUi('{"type":"video","url":"https://x"}').ok).toBe(false);
    expect(parseOpenbotUi('{"type":"progress","value":0.5,"onClick":"alert(1)"}').ok).toBe(false);
    expect(parseOpenbotUi('{"type":"card","image":"http://example.com/a.png"}').ok).toBe(false);
    expect(parseOpenbotUi('{"type":"card","image":"javascript:alert(1)"}').ok).toBe(false);
    expect(parseOpenbotUi('{"type":"progress",').ok).toBe(false);
    expect(parseOpenbotUi("").ok).toBe(false);
  });

  it("rejects mismatched charts, bad selects and repeated form fields", () => {
    expect(
      parseOpenbotUi('{"type":"chart","kind":"line","labels":["a","b"],"series":[{"name":"s","values":[1]}]}').ok,
    ).toBe(false);
    expect(
      parseOpenbotUi('{"type":"chart","kind":"donut","labels":["a"],"series":[{"name":"s","values":[-1]}]}').ok,
    ).toBe(false);
    expect(parseOpenbotUi('{"type":"form","id":"f","fields":[{"name":"a","label":"A","kind":"select"}]}').ok).toBe(
      false,
    );
    expect(
      parseOpenbotUi(
        '{"type":"form","id":"f","fields":[{"name":"a","label":"A","kind":"text"},{"name":"a","label":"B","kind":"text"}]}',
      ).ok,
    ).toBe(false);
    expect(parseOpenbotUi('{"type":"table","columns":["a"],"rows":[["x","y"]]}').ok).toBe(false);
  });

  it("caps size, nesting and node count", () => {
    const big = JSON.stringify({ type: "callout", tone: "info", body: "x".repeat(OPENBOT_UI_LIMITS.bytes) });
    expect(parseOpenbotUi(big)).toEqual({ ok: false, reason: "too large" });
    const nested = {
      type: "card",
      children: [{ type: "card", children: [{ type: "card", children: [{ type: "card" }] }] }],
    };
    expect(parseOpenbotUi(JSON.stringify(nested))).toEqual({ ok: false, reason: "nested too deep" });
    const ok3 = { type: "card", children: [{ type: "card", children: [{ type: "card" }] }] };
    expect(parseOpenbotUi(JSON.stringify(ok3)).ok).toBe(true);
    const many = Array.from({ length: 31 }, () => ({ type: "card", children: [{ type: "progress", value: 1 }] }));
    expect(parseOpenbotUi(JSON.stringify(many))).toEqual({ ok: false, reason: "too many nodes" });
  });
});

describe("fenceClosed", () => {
  it("knows a finished fence from one still streaming", () => {
    expect(fenceClosed('```openbot-ui\n{"type":"progress","value":1}\n```')).toBe(true);
    expect(fenceClosed('```openbot-ui\n{"type":"progress","value":1}\n```\n')).toBe(true);
    expect(fenceClosed('```openbot-ui\n{"type":"progress",')).toBe(false);
    expect(fenceClosed("````openbot-ui\n{}\n```")).toBe(false);
    expect(fenceClosed("```openbot-ui")).toBe(false);
  });
});

describe("estimateOpenbotUiHeight", () => {
  it("grows with what has arrived and stays within its bounds", () => {
    const small = estimateOpenbotUiHeight('{"type":"progress"');
    const large = estimateOpenbotUiHeight('{"type":"chart"}{"type":"table","rows":[["a"],["b"],["c"]]}');
    expect(small).toBeGreaterThanOrEqual(96);
    expect(large).toBeGreaterThan(small);
    expect(estimateOpenbotUiHeight('{"type":"x"}'.repeat(100))).toBe(420);
  });
});

describe("openbotUiActionMessage", () => {
  it("writes one machine line and a human label", () => {
    expect(openbotUiActionMessage("pick", "b", "Option  B")).toBe('[ui:action] {"id":"pick","value":"b"} — Option B');
    expect(openbotUiActionMessage("ok", undefined, "OK")).toBe('[ui:action] {"id":"ok"} — OK');
    expect(openbotUiActionMessage("f", { n: 2, ok: true }, "Sent")).toBe(
      '[ui:action] {"id":"f","value":{"n":2,"ok":true}} — Sent',
    );
  });
});

describe("formValues", () => {
  const fields: UiFormField[] = [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "n", label: "Count", kind: "number" },
    { name: "size", label: "Size", kind: "select", options: ["S", "M"] },
    { name: "ok", label: "Agree", kind: "toggle" },
  ];

  it("types the values and leaves empty optional fields out", () => {
    expect(formValues(fields, { name: " Ada ", n: "3", ok: true })).toEqual({ name: "Ada", n: 3, ok: true });
  });

  it("refuses a missing required field, a non-number and an unknown option", () => {
    expect(formValues(fields, { n: "3" })).toBeNull();
    expect(formValues(fields, { name: "A", n: "three" })).toBeNull();
    expect(formValues(fields, { name: "A", size: "XL" })).toBeNull();
  });
});
