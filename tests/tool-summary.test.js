// The compact record of what a turn did, stored on the message so history can
// be read back after the live tool events are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolTrace, formatToolSummary } from "#core/agent/tool-summary.js";

test("nothing to report yields null, so callers spread it conditionally", () => {
  // Returning {} would write an empty object into every message that used no
  // tools, which is most of them.
  assert.equal(summarizeToolTrace([]), null);
  assert.equal(summarizeToolTrace(null), null);
  assert.equal(summarizeToolTrace("not a trace"), null);
});

test("repeated calls collapse into one row with a count", () => {
  const s = summarizeToolTrace([
    { tool: "read_file", result: { ok: true } },
    { tool: "read_file", result: { ok: true } },
    { tool: "send_telegram", result: { ok: true } },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.tools.length, 2);
  assert.equal(s.tools.find((t) => t.name === "read_file").count, 2);
});

test("a failure is counted, not swallowed", () => {
  const s = summarizeToolTrace([
    { tool: "write_file", result: { error: "permission denied" } },
    { tool: "read_file", result: { ok: true } },
  ]);
  assert.equal(s.failed, 1);
  assert.equal(s.tools.find((t) => t.name === "write_file").failed, 1);
});

test("a message the budget suppressed counts as a failure", () => {
  // From the caller's point of view it did not happen, which is what the
  // reader needs to know.
  const s = summarizeToolTrace([{ tool: "send_telegram", result: { suppressed: true } }]);
  assert.equal(s.failed, 1);
});

test("failures sort first, so truncation cannot hide them", () => {
  const trace = [
    ...Array.from({ length: 30 }, () => ({ tool: "read_file", result: {} })),
    { tool: "run_shell", result: { error: "boom" } },
  ];
  const s = summarizeToolTrace(trace);
  assert.equal(s.tools[0].name, "run_shell");
  assert.equal(s.total, 31, "the total still reflects everything, even when the list is trimmed");
});

test("a runaway turn is trimmed rather than stored whole", () => {
  const trace = Array.from({ length: 40 }, (_, i) => ({ tool: `tool_${i}`, result: {} }));
  const s = summarizeToolTrace(trace);
  assert.ok(s.tools.length <= 12);
  assert.equal(s.total, 40);
});

test("a trace entry with no tool name still counts", () => {
  const s = summarizeToolTrace([{ result: {} }]);
  assert.equal(s.total, 1);
  assert.equal(s.tools[0].name, "tool");
});

test("the one-line form reads like a sentence, and is empty when there is nothing", () => {
  const s = summarizeToolTrace([
    { tool: "read_file", result: {} },
    { tool: "read_file", result: {} },
    { tool: "run_shell", result: { error: "no" } },
  ]);
  assert.equal(formatToolSummary(s), "run_shell (1 failed), read_file×2");
  assert.equal(formatToolSummary(null), "");
});
