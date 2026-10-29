import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunDetail } from "./data.ts";
import { capText, LOG_CAP, type LogWords, runLog } from "./run-log.ts";
import type { StepView } from "./run-view.ts";

const words: LogWords = {
  t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  took: () => "0.2 s",
  why: (code) => `why:${code}`,
};
const graph: RunDetail["graph"] = {
  schemaVersion: 2,
  nodes: [
    { id: "start", kind: "webhook", label: "New lead" },
    { id: "check", kind: "condition", label: "Is it a lead", input: { kind: "event", path: ["type"] }, equals: "lead" },
    {
      id: "save",
      kind: "table_write",
      label: "Save it",
      table: "leads",
      key: "last",
      value: { kind: "event", path: [] },
    },
    { id: "call", kind: "js", label: "Score", code: "return 1", input: { kind: "event", path: [] }, timeoutMs: 5000 },
  ],
  edges: [],
  layout: [],
};
const step = (
  node: string,
  state: RunDetail["steps"][number]["state"],
  started: string | null,
  ended: string | null,
) => ({
  node,
  state,
  started_at: started,
  ended_at: ended,
  input: null,
  output: null,
  truncated: false,
  error: state === "skipped" ? null : state === "failed" ? "code_failed" : null,
  run_id: null,
  thread_id: null,
});
const run = (over: Partial<RunDetail> = {}): RunDetail => ({
  flow: "f",
  event: "test:1",
  revision: 2,
  current: false,
  graph,
  state: "failed",
  created_at: "2026-10-29T10:00:00.000Z",
  ended_at: "2026-10-29T10:00:03.000Z",
  deadline_at: "2026-10-29T10:10:00.000Z",
  source: "webhook",
  scheduled_at: null,
  test: true,
  arrived: {
    headers: { "content-type": "application/json", "user-agent": "Northwind forms" },
    body: '{"type":"lead","name":"Ada"}',
    truncated: false,
  },
  steps: [
    step("start", "succeeded", "2026-10-29T10:00:00.000Z", "2026-10-29T10:00:00.000Z"),
    step("check", "succeeded", "2026-10-29T10:00:01.000Z", "2026-10-29T10:00:01.000Z"),
    step("save", "skipped", null, "2026-10-29T10:00:01.500Z"),
    step("call", "failed", "2026-10-29T10:00:02.000Z", "2026-10-29T10:00:02.500Z"),
  ],
  ...over,
});
const views = new Map<string, StepView>([
  ["start", { input: "POST", output: '{"type":"lead"}' }],
  ["check", { input: "Yes: type = lead", output: "matched" }],
  ["save", { input: "key last", output: "" }],
  ["call", { input: "x".repeat(LOG_CAP + 50), output: "boom" }],
]);

test("a run's log says what arrived first, then each step as it starts and ends, then how it ended", () => {
  const log = runLog(run(), { steps: views }, "POST /flows/test/leads", words);
  assert.deepEqual(
    log.map((e) => e.key),
    ["arrived", "check:start", "check:end", "save:end", "call:start", "call:end", "end"],
  );
  const [arrived] = log;
  assert.match(arrived?.title ?? "", /POST \/flows\/test\/leads/);
  assert.deepEqual(
    arrived?.blocks.map((b) => [b.label, b.text]),
    [
      ["flow.tlog.headers", "content-type: application/json\nuser-agent: Northwind forms"],
      ["flow.tlog.data", JSON.stringify({ type: "lead", name: "Ada" }, null, 2)],
    ],
  );
  assert.equal(log.find((e) => e.key === "save:end")?.tone, "muted");
  assert.equal(log.find((e) => e.key === "call:end")?.tone, "err");
  assert.equal(log.at(-1)?.title, "flow.tlog.end.failed");
});

test("a value is cut for the screen and says so; a step still going is marked live", () => {
  const log = runLog(
    run({
      state: "pending",
      ended_at: null,
      steps: [step("start", "succeeded", null, null), step("call", "running", "2026-10-29T10:00:02.000Z", null)],
    }),
    { steps: views },
    "POST /flows/test/leads",
    words,
  );
  const started = log.find((e) => e.key === "call:start");
  assert.equal(started?.tone, "live");
  assert.equal(started?.blocks[0]?.cut, true);
  assert.equal(started?.blocks[0]?.text.length, LOG_CAP + 1);
  assert.equal(
    log.some((e) => e.key === "end"),
    false,
  );
  assert.deepEqual(capText("short"), { text: "short", cut: false });
});

test("a run with nothing arrived says who started it, and the core's own cut shows as cut", () => {
  const owner = runLog(run({ source: "owner", arrived: null }), { steps: views }, "", words);
  assert.equal(owner[0]?.title, "flow.tlog.byYou");
  assert.equal(owner[0]?.blocks.length, 0);
  const cut = runLog(
    run({ arrived: { headers: {}, body: '{"a":1}', truncated: true } }),
    { steps: views },
    "POST /flows/leads",
    words,
  );
  assert.deepEqual(
    cut[0]?.blocks.map((b) => [b.label, b.cut]),
    [["flow.tlog.data", true]],
  );
});
