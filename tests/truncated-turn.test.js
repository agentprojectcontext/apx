// A model that hits its output cap mid-sentence has been cut off, not finished.
// The loop used to read "no tool calls" as a completed turn, so a routine that
// wrote its six ideas out as YAML instead of filing them — and ran out of budget
// halfway through the sixth — reported `status: ok` with a reply starting
// mid-word, and nothing was created.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "#core/agent/run-agent.js";

const CONFIG = { super_agent: { enabled: true, model: "mock", permission_mode: "total" } };

const SCHEMA = {
  type: "function",
  function: { name: "create_task", description: "Create a task", parameters: { type: "object", properties: {} } },
};

function harness() {
  const calls = [];
  const events = [];
  return {
    calls,
    events,
    opts: {
      globalConfig: CONFIG,
      system: "you are a test agent",
      toolSchemas: [SCHEMA],
      makeToolHandlers: () => ({ create_task: async () => { calls.push("create_task"); return { ok: true, id: "t_1" }; } }),
      toolHandlerCtx: {},
      onEvent: (e) => events.push(e),
      maxIters: 6,
    },
  };
}

test("a turn cut off at the output cap is continued, and the work actually happens", async () => {
  const h = harness();
  const out = await runAgent({ ...h.opts, prompt: "Generá las ideas [mock:cutoff:create_task]" });

  assert.deepEqual(h.calls, ["create_task"], "the tool the prose was standing in for was called");
  assert.ok(
    h.events.some((e) => e.type === "truncated_continue"),
    "the truncation is surfaced, not silently treated as a finished turn",
  );
  assert.ok(out.trace.some((t) => t.tool === "create_task"));
});

test("the nudge is a conversation turn, and it asks for the action rather than a rewrite", async () => {
  const h = harness();
  await runAgent({ ...h.opts, prompt: "Generá las ideas [mock:cutoff:create_task]" });
  const ev = h.events.find((e) => e.type === "truncated_continue");
  assert.equal(ev.attempt, 1, "first continuation of this turn");
});
