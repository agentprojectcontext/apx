import assert from "node:assert/strict";
import { test } from "node:test";
import { flowGraphGaps, flowStepGap } from "./flow-complete.ts";
import { newNode } from "./flow-edit.ts";
import { FlowDraftGraph, FlowDraftNode, FlowGraph, FlowNode } from "./flow-graph.ts";

const input = { kind: "event" as const, path: ["email"] };
/** One complete step of each kind: every setting a run needs is filled. */
const COMPLETE: FlowNode[] = [
  { id: "hook", label: "Hook", kind: "webhook" },
  { id: "tick", label: "Tick", kind: "schedule", cron: "30 8 * * 1-5" },
  {
    id: "check",
    label: "Check",
    kind: "condition",
    input,
    cases: [{ id: "yes", label: "Big", match: { kind: "expr", expr: "$trigger.n > 2" } }],
  },
  {
    id: "rules",
    label: "Rules",
    kind: "condition",
    input,
    cases: [
      {
        id: "full",
        label: "Complete",
        match: {
          kind: "all",
          rules: [
            { left: "$steps.normalize.ok", op: "equals", right: "true", type: "boolean" },
            { left: "$trigger.email", op: "not_empty", right: "", type: "text" },
          ],
        },
      },
      {
        id: "big",
        label: "Big",
        match: { kind: "any", rules: [{ left: "$trigger.total", op: "gte", right: "100", type: "number" }] },
      },
    ],
  },
  { id: "v", label: "V", kind: "vars", vars: [{ name: "x", value: { kind: "expr", expr: "$trigger.n" } }] },
  { id: "js", label: "JS", kind: "js", code: "return input;", input, timeoutMs: 2000 },
  {
    id: "sql",
    label: "SQL",
    kind: "sql",
    database: "data/app.db",
    mode: "read",
    query: "SELECT 1",
    params: [{ name: "p", value: "1" }],
    maxRows: 5,
    timeoutMs: 5000,
  },
  {
    id: "cmd",
    label: "Cmd",
    kind: "cmd",
    command: "ls",
    env: [{ name: "A", value: "1" }],
    stdin: "",
    timeoutMs: 5000,
    continueOnError: false,
  },
  { id: "rd", label: "Read", kind: "table_read", table: "leads", keys: ["$trigger.email"], columns: ["email"] },
  {
    id: "wr",
    label: "Save",
    kind: "table_write",
    table: "leads",
    key: "$trigger.email",
    columns: [{ name: "email", value: "$trigger.email" }],
  },
  {
    id: "llm",
    label: "LLM",
    kind: "llm",
    model: "acme/m",
    prompt: "Sum up",
    input,
    maxOutputTokens: 64,
    timeoutMs: 5000,
  },
  { id: "ai", label: "AI", kind: "agent", agent: "roby", prompt: "Answer", input },
  { id: "bot", label: "Bot", kind: "agent", bot: { name: "Helper", system: "Be brief" }, prompt: "Answer", input },
  { id: "rt", label: "Routine", kind: "routine", routine: "daily", input },
  {
    id: "tell",
    label: "Tell",
    kind: "notify",
    channel: "telegram",
    to: { kind: "contact", person: "owner" },
    text: "Hi",
    onlyIfContent: false,
  },
  {
    id: "out",
    label: "Out",
    kind: "http",
    method: "POST",
    url: "https://example.com/hook",
    headers: [{ name: "X-Key", value: "1" }],
    body: "",
    timeoutMs: 5000,
  },
];

test("every complete step parses as one that runs and has no gap", () => {
  for (const n of COMPLETE) {
    assert.equal(FlowNode.safeParse(n).success, true, n.id);
    assert.equal(flowStepGap(n), undefined, n.id);
  }
});

/** Each text in a step, emptied one at a time: where it lives and the step without it. */
function emptied(n: unknown, path: (string | number)[] = []): { path: (string | number)[]; step: unknown }[] {
  if (typeof n === "string") return n ? [{ path, step: "" }] : [];
  if (Array.isArray(n))
    return n.flatMap((v, i) =>
      emptied(v, [...path, i]).map((e) => ({ path: e.path, step: n.map((x, j) => (j === i ? e.step : x)) })),
    );
  if (n && typeof n === "object")
    return Object.entries(n).flatMap(([k, v]) =>
      ["id", "kind", "label", "mode", "method"].includes(k) && path.length === 0
        ? []
        : emptied(v, [...path, k]).map((e) => ({ path: e.path, step: { ...n, [k]: e.step } })),
    );
  return [];
}

test("a setting a draft may leave empty is one the shared rule names, so publishing never meets a surprise", () => {
  let tolerated = 0;
  for (const n of COMPLETE)
    for (const { path, step } of emptied(n)) {
      const runs = FlowNode.safeParse(step).success;
      const draft = FlowDraftNode.safeParse(step).success;
      // A draft tolerates no less than what runs, and what it tolerates beyond that is a gap the editor names.
      if (runs) assert.equal(draft, true, `${n.id}.${path.join(".")}`);
      if (draft && !runs) {
        tolerated++;
        assert.ok(flowStepGap(step as FlowDraftNode), `${n.id}.${path.join(".")} empty is not named`);
      }
    }
  assert.ok(tolerated >= 20);
});

test("a draft keeps empty settings but not a broken shape", () => {
  const js = { ...newNode("js", "js", "JavaScript"), code: "" };
  const graph = { schemaVersion: 2, nodes: [COMPLETE[0], js], edges: [{ source: "hook", target: "js" }], layout: [] };
  assert.equal(FlowGraph.safeParse(graph).success, false);
  assert.equal(FlowDraftGraph.safeParse(graph).success, true);
  assert.deepEqual(
    flowGraphGaps(FlowDraftGraph.parse(graph)).map((g) => [g.node.id, g.field]),
    [["js", "code"]],
  );
  // Ids, kinds, sizes and limits are checked in a draft as in what runs.
  for (const broken of [
    { ...js, kind: "python" },
    { ...js, id: "has space" },
    { ...js, timeoutMs: 999_999 },
    { ...js, code: "x".repeat(8001) },
    { ...js, label: "" },
  ])
    assert.equal(FlowDraftGraph.safeParse({ ...graph, nodes: [COMPLETE[0], broken] }).success, false);
  assert.equal(FlowDraftGraph.safeParse({ ...graph, nodes: [] }).success, false);
});

test("a check's comparisons: each needs a field, something to compare with and a value its type reads", () => {
  type Rule = {
    left: string;
    op: "equals" | "gt" | "empty" | "contains";
    right: string;
    type: "text" | "number" | "boolean";
  };
  const check = (rules: Rule[], kind: "all" | "any" = "all") =>
    ({
      id: "c",
      label: "C",
      kind: "condition",
      input,
      cases: [{ id: "yes", label: "", match: { kind, rules } }],
    }) as FlowDraftNode;
  const gap = (r: Partial<Rule>) =>
    flowStepGap(check([{ left: "$trigger.a", op: "equals", right: "x", type: "text", ...r }]));
  assert.equal(gap({}), undefined);
  assert.equal(gap({ left: " " }), "cases");
  assert.equal(gap({ right: "" }), "cases");
  assert.equal(gap({ op: "empty", right: "" }), undefined, "is empty reads the field alone");
  assert.equal(gap({ type: "number", right: "ten" }), "cases");
  assert.equal(gap({ type: "number", right: "10.5" }), undefined);
  assert.equal(gap({ type: "number", right: "$steps.limit.value" }), undefined, "a reference is read when it runs");
  assert.equal(gap({ type: "boolean", right: "yes" }), "cases");
  assert.equal(gap({ type: "boolean", right: "false" }), undefined);
  assert.equal(gap({ type: "text", op: "gt" }), "cases", "text offers no greater than");
  assert.equal(gap({ type: "number", op: "contains" }), "cases");
  // Joined by all or any, at least one comparison and at most ten.
  assert.equal(FlowDraftNode.safeParse(check([], "any")).success, false);
  const rule: Rule = { left: "$trigger.a", op: "equals", right: "x", type: "text" };
  assert.equal(FlowNode.safeParse(check(Array(10).fill(rule), "any")).success, true);
  assert.equal(FlowNode.safeParse(check(Array(11).fill(rule))).success, false);
  assert.equal(FlowNode.safeParse(check([{ ...rule, left: "" }])).success, false);
  assert.equal(FlowDraftNode.safeParse(check([{ ...rule, left: "" }])).success, true);
});

test("checks drawn before comparisons still parse and run as drawn", () => {
  const old = [
    { id: "a", label: "A", kind: "condition", input, equals: "gold" },
    {
      id: "b",
      label: "B",
      kind: "condition",
      input,
      cases: [{ id: "yes", label: "", match: { kind: "equals", value: 3 } }],
    },
    {
      id: "c",
      label: "C",
      kind: "condition",
      input,
      cases: [{ id: "yes", label: "", match: { kind: "expr", expr: "$trigger.n > 2" } }],
    },
  ];
  for (const n of old) {
    assert.equal(FlowNode.safeParse(n).success, true, n.id);
    assert.equal(flowStepGap(n as FlowDraftNode), undefined, n.id);
  }
  // A new check starts with one comparison to fill in.
  const fresh = newNode("condition", "c", "Check");
  assert.equal(flowStepGap(fresh), "cases");
  assert.equal(fresh.kind === "condition" && fresh.cases?.[0]?.match.kind, "all");
});

test("the steps a new drawing starts with say what they still need", () => {
  const gaps = Object.fromEntries(
    (["js", "sql", "cmd", "table_read", "table_write", "llm", "agent", "routine", "notify", "http"] as const).map(
      (k) => [k, flowStepGap(newNode(k, k, k))],
    ),
  );
  assert.deepEqual(gaps, {
    js: undefined,
    sql: "database",
    cmd: "command",
    table_read: "keys",
    table_write: "key",
    llm: "model",
    agent: "agent",
    routine: "routine",
    notify: "channel",
    http: "url",
  });
  // Without a table a read or a save uses the Flow's own: it runs.
  const save = newNode("table_write", "save", "Save");
  assert.equal(save.kind === "table_write" && flowStepGap({ ...save, key: "latest" }), undefined);
  // Every new step parses as a draft.
  for (const k of ["webhook", "schedule", "condition", "vars", "js", "sql", "cmd", "llm", "agent", "notify"] as const)
    assert.equal(FlowDraftNode.safeParse(newNode(k, k, k)).success, true, k);
});
