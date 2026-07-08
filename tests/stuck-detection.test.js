// Stuck detection: detector patterns + run-agent escalation (nudge → forced
// wrap-up). Offline: mock engine only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stuckDetectionConfig,
  createStuckDetector,
  stuckNudgeSignal,
} from "#core/agent/stuck-detector.js";
import { runAgent } from "#core/agent/run-agent.js";

const TEST_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "test_tool",
    description: "test tool",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

function cfg(overrides = {}) {
  return stuckDetectionConfig({
    super_agent: { stuck_detection: { enabled: true, ...overrides } },
  });
}

test("config defaults: enabled, action_repeat 4, error_repeat 3", () => {
  const c = stuckDetectionConfig({});
  assert.deepEqual(c, { enabled: true, action_repeat: 4, error_repeat: 3 });
  assert.equal(stuckDetectionConfig({ super_agent: { stuck_detection: { enabled: false } } }).enabled, false);
});

test("detector: identical action+observation N times → action_observation", () => {
  const d = createStuckDetector(cfg());
  for (let i = 0; i < 3; i++) {
    d.record({ tool: "read_file", argsSig: '{"path":"a"}', resultSig: '"same"', isError: false });
    assert.equal(d.check(), null);
  }
  d.record({ tool: "read_file", argsSig: '{"path":"a"}', resultSig: '"same"', isError: false });
  assert.deepEqual(d.check(), { pattern: "action_observation", tool: "read_file", repeats: 4 });
});

test("detector: changing results never trip the action pattern", () => {
  const d = createStuckDetector(cfg());
  for (let i = 0; i < 6; i++) {
    d.record({ tool: "read_file", argsSig: '{"path":"a"}', resultSig: `"r${i}"`, isError: false });
    assert.equal(d.check(), null);
  }
});

test("detector: same call erroring 3× → action_error even with different messages", () => {
  const d = createStuckDetector(cfg());
  for (let i = 0; i < 2; i++) {
    d.record({ tool: "run_shell", argsSig: '{"command":"x"}', resultSig: `"err${i}"`, isError: true });
    assert.equal(d.check(), null);
  }
  d.record({ tool: "run_shell", argsSig: '{"command":"x"}', resultSig: '"err2"', isError: true });
  assert.deepEqual(d.check(), { pattern: "action_error", tool: "run_shell", repeats: 3 });
});

test("detector: reset clears the window; disabled never fires", () => {
  const d = createStuckDetector(cfg());
  for (let i = 0; i < 4; i++) d.record({ tool: "t", argsSig: "{}", resultSig: '"s"', isError: false });
  assert.ok(d.check());
  d.reset();
  assert.equal(d.check(), null);

  const off = createStuckDetector(cfg({ enabled: false }));
  for (let i = 0; i < 8; i++) off.record({ tool: "t", argsSig: "{}", resultSig: '"s"', isError: false });
  assert.equal(off.check(), null);
});

test("stuckNudgeSignal names the tool and the loop shape", () => {
  const msg = stuckNudgeSignal({ tool: "read_file", repeats: 4, pattern: "action_observation" });
  assert.match(msg, /`read_file`/);
  assert.match(msg, /same result 4 times/);
  assert.match(stuckNudgeSignal({ tool: "x", repeats: 3, pattern: "action_error" }), /failing the same way 3 times/);
});

async function runLoopingAgent({ prompt, maxIters, stuck = {} }) {
  const events = [];
  const result = await runAgent({
    globalConfig: {
      super_agent: {
        enabled: true,
        model: "mock:test",
        permission_mode: "total",
        model_fallback: { enabled: false },
        stuck_detection: { enabled: true, ...stuck },
      },
      engines: {},
    },
    system: "sys",
    prompt,
    toolSchemas: [TEST_TOOL_SCHEMA],
    makeToolHandlers: () => ({ test_tool: async () => ({ ok: true, same: "always" }) }),
    toolHandlerCtx: {},
    onEvent: (e) => { events.push(e); },
    maxIters,
  });
  return { result, events };
}

test("run-agent: first stuck detection injects a nudge the model can react to", async () => {
  // [mock:loop:…] reads only the LAST user turn — after the nudge lands, the
  // mock stops looping and answers in prose, modeling a model that took the
  // hint. The turn must close with text, not silence.
  const { result, events } = await runLoopingAgent({
    prompt: "[mock:loop:test_tool]",
    maxIters: 12,
    stuck: { action_repeat: 3 },
  });
  const types = events.map((e) => e.type);
  assert.ok(types.includes("stuck_detected"), "stuck_detected must fire");
  assert.ok(!types.includes("stuck_abort"), "nudge landed — no abort");
  assert.equal(events.filter((e) => e.type === "tool_result").length, 3);
  assert.ok(result.text && result.text.trim().length > 0, "turn closes with model text");
});

test("run-agent: a model that ignores the nudge gets aborted into a wrap-up", async () => {
  // [mock:loopany:…] is sticky across user turns — the nudge is ignored, the
  // detector re-trips on fresh repetitions, and the loop forces the tool-free
  // wrap-up instead of burning the remaining budget.
  const { result, events } = await runLoopingAgent({
    prompt: "[mock:loopany:test_tool]",
    maxIters: 12,
    stuck: { action_repeat: 3 },
  });
  const types = events.map((e) => e.type);
  assert.ok(types.includes("stuck_detected"));
  assert.ok(types.includes("stuck_abort"));
  assert.ok(types.includes("final_wrapup"), "abort must route into the wrap-up close");
  // 3 repeats → nudge (reset) → 3 fresh repeats → abort. Nothing after.
  assert.equal(events.filter((e) => e.type === "tool_result").length, 6);
  assert.ok(result.text && result.text.trim().length > 0, "wrap-up text is non-empty");
});

test("run-agent: detection disabled → the loop runs to its budget untouched", async () => {
  const { events } = await runLoopingAgent({
    prompt: "[mock:loop:test_tool]",
    maxIters: 6,
    stuck: { enabled: false, action_repeat: 3 },
  });
  const types = events.map((e) => e.type);
  assert.ok(!types.includes("stuck_detected"));
  // All 5 action steps ran (the 6th is the reserved wrap-up).
  assert.equal(events.filter((e) => e.type === "tool_result").length, 5);
});
