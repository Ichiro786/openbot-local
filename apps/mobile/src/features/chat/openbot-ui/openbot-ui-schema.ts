// `openbot-ui` v1: a declarative UI block an agent writes in its reply as a fenced code block with
// the language `openbot-ui` (spec: docs/openbot-ui.md). The app renders it with its own native
// components; nothing in the block runs. Everything here is pure, so it is unit tested.
//
// The block holds JSON: one node, an array of nodes, or one node per line (JSONL, as it streams).
// Strict validation: an unknown type, an unknown field, a value over its cap, an http (not https)
// picture or nesting deeper than MAX_DEPTH makes the whole block invalid, and the chat then shows
// the code block as it is.
import { z } from "zod";

/** Caps per block. A block over any of them is shown as code. */
export const OPENBOT_UI_LIMITS = {
  bytes: 16 * 1024,
  nodes: 60,
  depth: 3,
  text: 600,
  body: 4000,
  columns: 8,
  rows: 50,
  stats: 6,
  listItems: 20,
  actions: 8,
  fields: 10,
  options: 12,
  steps: 12,
  chartLabels: 24,
  chartSeries: 4,
} as const;

const L = OPENBOT_UI_LIMITS;
const text = z.string().max(L.text);
const label = z.string().min(1).max(L.text);
const id = z.string().regex(/^[\w.:-]{1,64}$/u);
const scalar = z.union([z.string().max(L.text), z.number().finite(), z.boolean()]);
const httpsUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^\s]+$/u);
const tone = z.enum(["positive", "negative", "neutral"]);

export type UiScalar = z.infer<typeof scalar>;

const stats = z.strictObject({
  type: z.literal("stats"),
  items: z
    .array(
      z.strictObject({
        label,
        value: z.union([text, z.number().finite()]),
        delta: text.optional(),
        tone: tone.optional(),
      }),
    )
    .min(1)
    .max(L.stats),
});

const table = z
  .strictObject({
    type: z.literal("table"),
    title: text.optional(),
    columns: z.array(text).min(1).max(L.columns),
    rows: z.array(z.array(z.union([text, z.number().finite(), z.null()])).max(L.columns)).max(L.rows),
  })
  .refine((value) => value.rows.every((row) => row.length <= value.columns.length), "row longer than columns");

const chart = z
  .strictObject({
    type: z.literal("chart"),
    kind: z.enum(["bar", "line", "donut"]),
    title: text.optional(),
    labels: z.array(text).min(1).max(L.chartLabels),
    series: z
      .array(z.strictObject({ name: text, values: z.array(z.number().finite()).max(L.chartLabels) }))
      .min(1)
      .max(L.chartSeries),
  })
  .refine(
    (value) => value.series.every((series) => series.values.length === value.labels.length),
    "every series needs one value per label",
  )
  .refine(
    (value) => value.kind !== "donut" || (value.series.length === 1 && value.series[0]?.values.every((v) => v >= 0)),
    "a donut has one series of values >= 0",
  );

export const UI_ICONS = [
  "check",
  "x",
  "info",
  "warning",
  "star",
  "file",
  "folder",
  "link",
  "calendar",
  "clock",
  "user",
  "mail",
  "chart",
  "money",
  "cart",
  "location",
  "bolt",
  "heart",
] as const;
export type UiIcon = (typeof UI_ICONS)[number];

const list = z.strictObject({
  type: z.literal("list"),
  title: text.optional(),
  items: z
    .array(
      z.strictObject({
        icon: z.enum(UI_ICONS).optional(),
        title: label,
        subtitle: text.optional(),
        trailing: text.optional(),
      }),
    )
    .min(1)
    .max(L.listItems),
});

const actions = z.strictObject({
  type: z.literal("actions"),
  style: z.enum(["buttons", "chips"]).optional(),
  items: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(80),
        value: scalar.optional(),
        style: z.enum(["primary", "secondary", "danger"]).optional(),
      }),
    )
    .min(1)
    .max(L.actions),
});

const field = z
  .strictObject({
    name: id,
    label: z.string().min(1).max(120),
    kind: z.enum(["text", "number", "select", "toggle"]),
    options: z.array(z.string().min(1).max(80)).min(1).max(L.options).optional(),
    placeholder: z.string().max(120).optional(),
    required: z.boolean().optional(),
    default: scalar.optional(),
  })
  .refine((value) => (value.kind === "select") === (value.options !== undefined), "select needs options, others none");

const form = z
  .strictObject({
    type: z.literal("form"),
    id,
    title: text.optional(),
    fields: z.array(field).min(1).max(L.fields),
    submit: z.string().min(1).max(40).optional(),
  })
  .refine((value) => new Set(value.fields.map((f) => f.name)).size === value.fields.length, "field names repeat");

const steps = z.strictObject({
  type: z.literal("steps"),
  title: text.optional(),
  items: z
    .array(z.strictObject({ label, detail: text.optional(), status: z.enum(["done", "active", "pending", "failed"]) }))
    .min(1)
    .max(L.steps),
});

const progress = z.strictObject({
  type: z.literal("progress"),
  value: z.number().min(0).max(1),
  label: text.optional(),
});

const callout = z.strictObject({
  type: z.literal("callout"),
  tone: z.enum(["info", "success", "warning", "error"]),
  title: text.optional(),
  body: z.string().min(1).max(L.body),
});

export type UiStats = z.infer<typeof stats>;
export type UiTable = z.infer<typeof table>;
export type UiChart = z.infer<typeof chart>;
export type UiList = z.infer<typeof list>;
export type UiActions = z.infer<typeof actions>;
export type UiForm = z.infer<typeof form>;
export type UiFormField = z.infer<typeof field>;
export type UiSteps = z.infer<typeof steps>;
export type UiProgress = z.infer<typeof progress>;
export type UiCallout = z.infer<typeof callout>;
export interface UiCard {
  type: "card";
  title?: string;
  subtitle?: string;
  body?: string;
  image?: string;
  children?: UiNode[];
}
export type UiNode =
  | UiCard
  | UiStats
  | UiTable
  | UiChart
  | UiList
  | UiActions
  | UiForm
  | UiSteps
  | UiProgress
  | UiCallout;

const card: z.ZodType<UiCard> = z.strictObject({
  type: z.literal("card"),
  title: text.optional(),
  subtitle: text.optional(),
  body: z.string().max(L.body).optional(),
  image: httpsUrl.optional(),
  children: z
    .array(z.lazy(() => node))
    .max(L.nodes)
    .optional(),
});

const node: z.ZodType<UiNode> = z.union([card, stats, table, chart, list, actions, form, steps, progress, callout]);

export type OpenbotUiParse = { ok: true; nodes: UiNode[] } | { ok: false; reason: string };

function depthAndCount(nodes: readonly UiNode[], depth: number): { depth: number; count: number } {
  let deepest = depth;
  let count = 0;
  for (const item of nodes) {
    count += 1;
    if (item.type === "card" && item.children?.length) {
      const inner = depthAndCount(item.children, depth + 1);
      deepest = Math.max(deepest, inner.depth);
      count += inner.count;
    }
  }
  return { depth: deepest, count };
}

/** The JSON values of a block: one value, the items of an array, or one value per non-empty line. */
function jsonValues(source: string): unknown[] | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return Array.isArray(value) ? value : [value];
  } catch {
    // JSONL: one node per line.
  }
  const values: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return values;
}

/** Parses and validates a finished block. Never throws. */
export function parseOpenbotUi(source: string): OpenbotUiParse {
  if (new TextEncoder().encode(source).length > L.bytes) return { ok: false, reason: "too large" };
  const values = jsonValues(source);
  if (!values || values.length === 0) return { ok: false, reason: "not JSON" };
  const parsed = z.array(node).max(L.nodes).safeParse(values);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid" };
  const shape = depthAndCount(parsed.data, 1);
  if (shape.depth > L.depth) return { ok: false, reason: "nested too deep" };
  if (shape.count > L.nodes) return { ok: false, reason: "too many nodes" };
  return { ok: true, nodes: parsed.data };
}

/**
 * Height to reserve for a block that is still streaming, from what has arrived, so the finished
 * block lands close to the skeleton's size. Clamped to 96..420 dp.
 */
export function estimateOpenbotUiHeight(partial: string): number {
  const count = (pattern: RegExp) => partial.match(pattern)?.length ?? 0;
  const types = count(/"type"\s*:/gu);
  const rows = count(/\],\s*\[/gu) + count(/"title"\s*:/gu) / 2;
  const charts = count(/"type"\s*:\s*"chart"/gu);
  const estimate = 56 + types * 64 + rows * 22 + charts * 140;
  return Math.round(Math.min(420, Math.max(96, estimate)));
}

/** True when a fenced block's raw markdown has its closing fence (it is complete while streaming). */
export function fenceClosed(raw: string): boolean {
  const lines = raw.trimEnd().split("\n");
  if (lines.length < 2) return false;
  const open = /^\s*(`{3,}|~{3,})/u.exec(lines[0] ?? "")?.[1];
  const close = (lines[lines.length - 1] ?? "").trim();
  if (!open || !/^(`{3,}|~{3,})$/u.test(close)) return false;
  return close[0] === open[0] && close.length >= open.length;
}

/**
 * The user message an action sends to the same chat: a machine line any agent can read, then a
 * short human label. `[ui:action] {"id":"pick","value":"b"} — Option B`.
 */
export function openbotUiActionMessage(
  actionId: string,
  value: UiScalar | Record<string, UiScalar> | undefined,
  label: string,
): string {
  const payload = JSON.stringify(value === undefined ? { id: actionId } : { id: actionId, value });
  return `[ui:action] ${payload} — ${label.replace(/\s+/gu, " ").trim()}`;
}

/** A form's values from its fields' drafts: numbers as numbers, toggles as booleans. Null when a required field is empty or a number is not one. */
export function formValues(
  fields: readonly UiFormField[],
  drafts: Readonly<Record<string, UiScalar | undefined>>,
): Record<string, UiScalar> | null {
  const out: Record<string, UiScalar> = {};
  for (const item of fields) {
    const raw = drafts[item.name] ?? item.default;
    if (item.kind === "toggle") {
      out[item.name] = raw === true;
      continue;
    }
    const textValue = raw === undefined || raw === null ? "" : String(raw).trim();
    if (!textValue) {
      if (item.required) return null;
      continue;
    }
    if (item.kind === "number") {
      const number = Number(textValue);
      if (!Number.isFinite(number)) return null;
      out[item.name] = number;
    } else if (item.kind === "select") {
      if (!item.options?.includes(textValue)) return null;
      out[item.name] = textValue;
    } else {
      out[item.name] = textValue.slice(0, 2000);
    }
  }
  return out;
}
