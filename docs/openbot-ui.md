# `openbot-ui` — rich UI in agent replies (OpenBot Local, v1)

An agent can put a fenced code block with the language `openbot-ui` in a reply. The OpenBot Local
Android app draws it as native UI (cards, stats, tables, charts, lists, buttons, forms, steps,
progress, callouts). Nothing in the block runs: it is plain JSON data. Other clients (desktop,
web) show the JSON as a code block, so always keep a one-line prose summary outside the block.

The engine (patch `0004-openbot-ui-guide`, engine `0.70.0-2` and later) teaches every agent this
format in its system prompt. **Settings → Local engine → Rich UI in replies** turns that guide off
(it writes `/root/.openbot-local/openbot-ui.json` `{"enabled":false}` inside the engine; a missing
file means ON). Blocks an agent still writes are drawn either way.

Source: `apps/mobile/src/features/chat/openbot-ui/openbot-ui-schema.ts` (schema and limits) and
`openbot-ui-block.tsx` (rendering).

## When to use it

Use a block only when structure clearly beats prose: a comparison or table, numbers and stats, a
chart of real data, a choice as buttons or chips, several fields to collect, step-by-step status,
progress. Not for casual chat, short answers or personal talk. At most two blocks per reply. Never
invent or pad data for a chart, table or stat. Approvals for sends, deletes and payments still go
through `openbot.ask_ui`.

## Format

The block body is JSON in one of three shapes:

- one node: `{"type":"callout", ...}`
- an array of nodes: `[{...}, {...}]`
- one node per line (JSONL), which is also how it looks while it streams

While the reply streams, the app shows a placeholder sized from what has arrived and draws the
block once its closing fence arrives (or the reply finishes). Validation is strict: an unknown
`type`, an unknown field, a value over its cap, an `http:` (not `https:`) image or nesting deeper
than 3 makes the whole block invalid, and the app then shows "This interface could not be shown, so
here is its code." with the plain code block.

### Limits per block

| What | Max |
| --- | --- |
| Block size | 16 KB |
| Nodes (counting card children) | 60 |
| Nesting (card in card in card) | 3 |
| Short text (titles, labels, cells) | 600 chars |
| Body text (card body, callout body) | 4000 chars |
| Table columns / rows | 8 / 50 |
| Stats items | 6 |
| List items | 20 |
| Actions | 8 |
| Form fields / select options | 10 / 12 |
| Steps | 12 |
| Chart labels / series | 24 / 4 |
| Ids (`actions[].id`, `form.id`, `fields[].name`) | `[A-Za-z0-9_.:-]`, 1–64 chars |

## Nodes

| `type` | Fields (`?` = optional) |
| --- | --- |
| `card` | `title?`, `subtitle?`, `body?` (markdown), `image?` (https URL), `children?` (nodes) |
| `stats` | `items: [{label, value (text or number), delta?, tone?: positive\|negative\|neutral}]` |
| `table` | `title?`, `columns: [text]`, `rows: [[text \| number \| null]]` (a row may not be longer than `columns`) |
| `chart` | `kind: bar\|line\|donut`, `title?`, `labels: [text]`, `series: [{name, values: [number]}]` — every series has one value per label; a donut has exactly one series of values ≥ 0 |
| `list` | `title?`, `items: [{icon?, title, subtitle?, trailing?}]` |
| `actions` | `style?: buttons\|chips`, `items: [{id, label (≤80), value? (text/number/bool), style?: primary\|secondary\|danger}]` |
| `form` | `id`, `title?`, `fields: [{name, label, kind: text\|number\|select\|toggle, options? (select only, required there), placeholder?, required?, default?}]`, `submit?` (button label, ≤40) |
| `steps` | `title?`, `items: [{label, detail?, status: done\|active\|pending\|failed}]` |
| `progress` | `value` (0..1), `label?` |
| `callout` | `tone: info\|success\|warning\|error`, `title?`, `body` (markdown) |

List icons: `check`, `x`, `info`, `warning`, `star`, `file`, `folder`, `link`, `calendar`,
`clock`, `user`, `mail`, `chart`, `money`, `cart`, `location`, `bolt`, `heart`.

## What a tap sends back

A button, chip or form submit sends an ordinary user message to the same chat:

```
[ui:action] {"id":"plan","value":"pro"} — Pro
[ui:action] {"id":"trip","value":{"city":"Agra","nights":2,"breakfast":true}} — Sent the form (City: Agra, Nights: 2, Breakfast included: yes)
```

The agent should treat it as the user's answer and carry on, without showing the same UI again.
One answer per block: after a tap or submit, the block's buttons are disabled and the chosen one is
marked (for this app run).
Actions are only live where the chat can send (not in read-only chats or while offline).

## Copy-paste examples

### Stats + table (comparison)

````
Here is how the three plans compare:

```openbot-ui
{"type":"stats","items":[{"label":"Cheapest","value":"Basic","delta":"₹199/mo","tone":"positive"},{"label":"Most storage","value":"Pro","delta":"2 TB"}]}
{"type":"table","title":"Plans","columns":["Plan","Price / mo","Storage","Devices"],"rows":[["Basic","₹199","100 GB",2],["Plus","₹449","500 GB",4],["Pro","₹899","2 TB",null]]}
```
````

### Chart

````
Your disk use by folder this week:

```openbot-ui
{"type":"chart","kind":"donut","title":"Disk use (GB)","labels":["Workspaces","Caches","Logs"],"series":[{"name":"GB","values":[12.4,3.1,0.6]}]}
```
````

````
```openbot-ui
{"type":"chart","kind":"bar","title":"Commits per day","labels":["Mon","Tue","Wed","Thu","Fri"],"series":[{"name":"build15","values":[4,7,2,9,5]},{"name":"main","values":[1,0,3,2,1]}]}
```
````

### Choice as chips

````
Which one should I set up?

```openbot-ui
{"type":"actions","style":"chips","items":[{"id":"plan","label":"Basic","value":"basic"},{"id":"plan","label":"Plus","value":"plus"},{"id":"plan","label":"Pro","value":"pro","style":"primary"}]}
```
````

### Form

````
A few details and I'll book it:

```openbot-ui
{"type":"form","id":"trip","title":"Trip","fields":[{"name":"city","label":"City","kind":"text","required":true},{"name":"nights","label":"Nights","kind":"number","default":2},{"name":"room","label":"Room","kind":"select","options":["Single","Double","Suite"]},{"name":"breakfast","label":"Breakfast included","kind":"toggle","default":true}],"submit":"Continue"}
```
````

### Card with list and steps

````
Release status:

```openbot-ui
{"type":"card","title":"Build 15","subtitle":"versionCode 10412","children":[{"type":"steps","items":[{"label":"Engine 0.70.0-2","status":"done"},{"label":"Android build","status":"active"},{"label":"Emulator e2e","status":"pending"}]},{"type":"list","items":[{"icon":"file","title":"openbot-local-1.4.9.apk","trailing":"312 MB"},{"icon":"link","title":"Run 4349…","subtitle":"GitHub Actions"}]}]}
```
````

### Progress and callout

````
```openbot-ui
{"type":"progress","value":0.62,"label":"Indexing workspace"}
{"type":"callout","tone":"warning","title":"Low space","body":"Only **1.2 GB** left. Clear old downloads in Settings → Local engine → Storage."}
```
````
