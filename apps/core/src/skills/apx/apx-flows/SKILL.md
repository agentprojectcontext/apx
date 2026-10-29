---
name: apx-flows
description: Draw or change an APX Flow for the owner (a webhook or schedule that runs checks, tables, code, an AI model, a message or a request), through apx_settings' flows area. Use it whenever the owner asks for a Flow, an automation, "when X arrives do Y", or to change the steps of one.
---

# Flows in APX

A Flow belongs to a project and runs the steps drawn in its editor. You draw and change its **draft**; the owner
publishes it from the editor (Save with the Flow on, or turning it on). Nothing you save runs until then, and anything
that sends as the owner, calls a URL, runs a command or changes a database asks them first. Never claim a Flow is on
or running: say it is ready for them to review and turn on.

## Calls (apx_settings, method + params)

- `flows.list {project?}`: each Flow with its id, project, on/off and whether a draft waits.
- `flows.graph_get {flow, which?}`: its steps and connections as JSON, and `draftVersion`.
- `flows.create {project, name, graph | edits}`: a new Flow, off, with that drawing as its draft.
- `flows.draft_save {flow, edits}`: edits on the latest draft (or what runs, when there is no draft).
- `flows.draft_save {flow, expectedVersion, graph}`: replace the whole drawing; `expectedVersion` is the
  `draftVersion` you read (null when there was none). If someone saved meanwhile, read again and redo it.
- `flows.validate {flow}`: whether the draft can run, and why not.

Every save answers with what still keeps it from running, step by step: fix those with more edits. The chat shows the
owner a card with the drawing and **Open in the editor**. Places on the canvas are filled in for you; `{op: "tidy"}`
lays the whole drawing out again.

Edits, applied in order: `{op: "add", step: {kind, id?, label?, …fields}, after?: "<step id>", when?}`,
`{op: "update", step: "<id>", set: {…fields}}`, `{op: "remove", step}`, `{op: "connect", from, to, when?}`,
`{op: "disconnect", from, to}`, `{op: "tidy"}`. A new step gets a short id from its kind (`http`, `http_2`…) unless you
give one; give each a `label` in the owner's language.

## The drawing

`{nodes: [step…], edges: [{source, target, when?}]}`. Exactly one trigger, and every step reachable from it; no
loops. `when` is only on a connection out of a check: a case's id, or `"no"` for otherwise.

Values a step reads are **bindings**: `{kind: "event", path: ["form", "email"]}` (what arrived),
`{kind: "node", node: "<step id>", path: [...]}` (an earlier step's output) or `{kind: "literal", value}`. Text
fields marked *template* take placeholders: `$trigger.form.email`, `$steps.<step>.field`, `$vars.name`, `$apx.now`,
`$apx.project`, `$apx.run`, and `$$` for a `$`.

| kind | fields |
|---|---|
| `webhook` | (none): POST with JSON starts it |
| `schedule` | `cron`: five fields in the owner's time zone, at most every five minutes (`"30 8 * * 1-5"`) |
| `condition` | `input` binding; `cases: [{id, label, match: {kind: "equals", value} \| {kind: "expr", expr}}]` (1–15). Ways out: each case id, then `"no"` |
| `vars` | `vars: [{name, value: {kind: "literal", value} \| {kind: "expr", expr}}]`; later steps read `$vars.name` |
| `js` | `code`: body of `function (input, vars)` returning JSON; `input` binding; `timeoutMs` 100–10000. No files, network or programs |
| `sql` | `database` (SQLite file in the project folder), `mode: read\|write`, `query` with `:name` parameters, `params: [{name, value template}]`, `maxRows` 1–500, `timeoutMs` 1000–30000 |
| `cmd` | `command` (fixed text, no placeholders), `env: [{name, value template}]`, `stdin` template, `timeoutMs` 1000–120000, `continueOnError` |
| `table_read` | `table?` (project table name), `keys: [template]` or `latest: 1–100` |
| `table_write` | `table?`, `key` template, `value` binding |
| `agent` (AI model) | `agent` (an agent id of the project, or the super-agent) **or** `bot: {name, system}`; `prompt`; `input` binding; `model?` (`engine/model#effort`) |
| `llm` | `model` (`provider/model` of a set-up API), `prompt`, `input`, `maxOutputTokens` 1–2048, `timeoutMs` 1000–120000 |
| `routine` | `routine` (a manual routine of the project), `input` |
| `notify` | `channel` (a channel id), `to: {kind: "contact", person} \| {kind: "room", room}`, `text` template, `onlyIfContent` |
| `http` | `method: GET\|POST\|PUT`, `url` (fixed, public), `headers: [{name, value template}]` (keys only as `secret://NAME`), `body` template, `timeoutMs` 1000–30000 |

Expressions (`expr`): `$trigger.a`, `$steps.s.a`, `$vars.x`, literals, `== != < <= > >=`, `&& || !`, `+ - * / %`,
`? :`, and `len lower upper trim contains startsWith endsWith number text round floor ceil abs min max join exists`.
Nothing is run as code.

How freely an AI step acts (`autonomy`, `write`, `delegate`) is the owner's to set in the editor: leave those out.
Find ids with `apx_settings`' other areas (agents, routines, channels, contacts) before you name them; a secret goes
only as `secret://NAME` in an `http` header or a `cmd` variable, never its value.

## Example

A webhook that saves each lead under its email and tells the owner on a channel:

```json
{"method": "flows.create", "params": {"project": "<project id>", "name": "New leads", "edits": [
  {"op": "add", "step": {"kind": "webhook", "id": "hook", "label": "New lead"}},
  {"op": "add", "after": "hook", "step": {"kind": "table_write", "id": "save", "label": "Save the lead",
    "table": "leads", "key": "$trigger.email", "value": {"kind": "event", "path": []}}},
  {"op": "add", "after": "save", "step": {"kind": "notify", "id": "tell", "label": "Tell me",
    "channel": "<channel id>", "to": {"kind": "contact", "person": "owner"}, "text": "New lead: $trigger.email",
    "onlyIfContent": true}}
]}}
```
