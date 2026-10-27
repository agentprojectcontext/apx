import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFlow, type Flow, parseFlowDraft } from "./flow-form.ts";

const definition: Flow = {
  id: "intake",
  projectId: "acme",
  name: "Intake",
  enabled: false,
  predicates: [{ path: ["type"], equals: "message" }],
  tableKey: "inbox",
  action: { kind: "none" },
};

test("Flow editor round-trips every fixed action without losing project or filters", () => {
  for (const action of [
    { kind: "none" },
    { kind: "agent", agent: "support", prompt: "Process the row" },
    { kind: "routine", routine: "review" },
  ] as const) {
    const flow = { ...definition, action };
    assert.deepEqual(parseFlowDraft(draftFlow(flow)), flow);
  }
});

test("Flow editor preserves fixed read keys exactly, including spaces and commas, and enforces read limits", () => {
  for (const readKeys of [undefined, [], ["settings", "key,with,commas", " spaced key "]]) {
    const flow = { ...definition, ...(readKeys === undefined ? {} : { readKeys }) };
    assert.deepEqual(parseFlowDraft(draftFlow(flow)), flow);
  }
  for (const readKeysJson of [
    "{",
    "{}",
    "null",
    '[""]',
    "[1]",
    JSON.stringify(Array.from({ length: 17 }, () => "key")),
    JSON.stringify(["k".repeat(129)]),
  ]) {
    assert.equal(parseFlowDraft({ ...draftFlow(definition), readKeysJson }), undefined);
  }
});

test("Flow editor enforces the 100-character identifier boundary", () => {
  assert.equal(parseFlowDraft({ ...draftFlow(definition), id: "f".repeat(100) })?.id.length, 100);
  for (const patch of [
    { id: "f".repeat(101) },
    { projectId: "p".repeat(101) },
    { actionKind: "routine" as const, binding: "r".repeat(101) },
  ])
    assert.equal(parseFlowDraft({ ...draftFlow(definition), ...patch }), undefined);
});

test("Flow editor rejects invalid JSON, non-scalar values, unknown fields and malformed paths", () => {
  for (const filters of [
    "{",
    "null",
    "{}",
    '[{"path":[],"equals":1}]',
    '[{"path":[""],"equals":true}]',
    '[{"path":["x"],"equals":{}}]',
    '[{"path":["x"]}]',
    '[{"path":["x"],"equals":1,"tool":"shell"}]',
    JSON.stringify(Array.from({ length: 33 }, () => ({ path: ["x"], equals: true }))),
  ]) {
    assert.equal(parseFlowDraft({ ...draftFlow(definition), filters }), undefined, filters);
  }
});

test("Flow editor validates IDs and explicit action bindings and permits empty filter lists", () => {
  const draft = draftFlow(definition);
  assert.deepEqual(parseFlowDraft({ ...draft, filters: "[]" })?.predicates, []);
  for (const patch of [
    { id: "../flow" },
    { projectId: "~default" },
    { name: " " },
    { tableKey: "" },
    { actionKind: "agent" as const, binding: "support", prompt: "" },
    { actionKind: "routine" as const, binding: "" },
  ]) {
    assert.equal(parseFlowDraft({ ...draft, ...patch }), undefined);
  }
});
