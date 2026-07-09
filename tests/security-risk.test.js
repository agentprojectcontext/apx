// Inline security-risk analysis (OpenHands LLMSecurityAnalyzer pattern):
// schema injection, risk extraction, ConfirmRisky policy, and the run-agent
// gate. Offline: mock engine, no HOME writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRisk,
  withSecurityRiskField,
  popSecurityRisk,
  shouldConfirmRisk,
  securityRiskConfig,
} from "#core/agent/security.js";
import { runAgent, FINISH_TOOL_SCHEMA } from "#core/agent/run-agent.js";

const TEST_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "test_tool",
    description: "test tool",
    parameters: { type: "object", properties: { x: { type: "string" } }, required: [] },
  },
};

function baseConfig(overrides = {}) {
  return {
    super_agent: {
      enabled: true,
      model: "mock:test",
      permission_mode: "automatico",
      model_fallback: { enabled: false },
      security_risk: { enabled: true, confirm_at: "HIGH", confirm_unknown: true },
      ...overrides,
    },
    engines: {},
  };
}

test("normalizeRisk maps unknown junk to UNKNOWN", () => {
  assert.equal(normalizeRisk("high"), "HIGH");
  assert.equal(normalizeRisk(" Medium "), "MEDIUM");
  assert.equal(normalizeRisk("LOW"), "LOW");
  assert.equal(normalizeRisk("nope"), "UNKNOWN");
  assert.equal(normalizeRisk(undefined), "UNKNOWN");
});

test("withSecurityRiskField injects a required enum, first in properties", () => {
  const [out] = withSecurityRiskField([TEST_TOOL_SCHEMA]);
  const params = out.function.parameters;
  assert.deepEqual(Object.keys(params.properties)[0], "security_risk");
  assert.deepEqual(params.properties.security_risk.enum, ["LOW", "MEDIUM", "HIGH"]);
  assert.ok(params.required.includes("security_risk"));
  // Original untouched (module-level schemas are shared across sessions).
  assert.ok(!TEST_TOOL_SCHEMA.function.parameters.properties.security_risk);
  assert.ok(!TEST_TOOL_SCHEMA.function.parameters.required.includes("security_risk"));
});

test("withSecurityRiskField skips loop-control tools and is idempotent", () => {
  const askSchema = {
    type: "function",
    function: { name: "ask_questions", parameters: { type: "object", properties: {} } },
  };
  const [finish, ask] = withSecurityRiskField([FINISH_TOOL_SCHEMA, askSchema]);
  assert.equal(finish, FINISH_TOOL_SCHEMA);
  assert.equal(ask, askSchema);
  const once = withSecurityRiskField([TEST_TOOL_SCHEMA]);
  const twice = withSecurityRiskField(once);
  assert.equal(
    twice[0].function.parameters.required.filter((r) => r === "security_risk").length,
    1
  );
});

test("popSecurityRisk extracts and strips the field", () => {
  const args = { security_risk: "medium", x: "1" };
  assert.equal(popSecurityRisk(args), "MEDIUM");
  assert.deepEqual(args, { x: "1" });
  assert.equal(popSecurityRisk({}), "UNKNOWN");
  assert.equal(popSecurityRisk(null), "UNKNOWN");
});

test("shouldConfirmRisk honors threshold and confirm_unknown", () => {
  const cfg = securityRiskConfig(baseConfig());
  assert.equal(shouldConfirmRisk("LOW", cfg), false);
  assert.equal(shouldConfirmRisk("MEDIUM", cfg), false);
  assert.equal(shouldConfirmRisk("HIGH", cfg), true);
  assert.equal(shouldConfirmRisk("UNKNOWN", cfg), true);

  const medium = securityRiskConfig(
    baseConfig({ security_risk: { enabled: true, confirm_at: "MEDIUM", confirm_unknown: false } })
  );
  assert.equal(shouldConfirmRisk("MEDIUM", medium), true);
  assert.equal(shouldConfirmRisk("UNKNOWN", medium), false);

  const off = securityRiskConfig(baseConfig({ security_risk: { enabled: false } }));
  assert.equal(shouldConfirmRisk("HIGH", off), false);
});

async function runMockAgent({ globalConfig, requestConfirmation, handler, riskArg }) {
  const events = [];
  const toolHandlerCtx = { globalConfig, requestConfirmation };
  const executed = [];
  const result = await runAgent({
    globalConfig,
    system: "sys",
    prompt: `[mock:tool:test_tool]${riskArg ? ` [mock:risk:${riskArg}]` : ""} do it`,
    toolSchemas: [TEST_TOOL_SCHEMA],
    makeToolHandlers: () => ({
      test_tool: handler || (async (args) => { executed.push(args); return { ok: true }; }),
    }),
    toolHandlerCtx,
    onEvent: (e) => { events.push(e); },
    maxIters: 3,
  });
  return { result, events, executed };
}

test("run-agent gate: ungraded call pauses, approval executes the tool", async () => {
  const confirmations = [];
  const { result, events, executed } = await runMockAgent({
    globalConfig: baseConfig(),
    requestConfirmation: async (tool, _args, description) => {
      confirmations.push({ tool, description });
      return true;
    },
  });
  // Mock emits arguments:"{}" → no grade → UNKNOWN → confirm_unknown pauses.
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].tool, "test_tool");
  assert.match(confirmations[0].description, /risk: UNKNOWN/);
  assert.equal(executed.length, 1);
  assert.ok(events.some((e) => e.type === "security_confirmation"));
  const item = result.trace.find((t) => t.tool === "test_tool");
  assert.equal(item.security_risk, "UNKNOWN");
  assert.deepEqual(item.result, { ok: true });
});

test("run-agent gate: decline blocks execution and surfaces an error observation", async () => {
  const { result, executed } = await runMockAgent({
    globalConfig: baseConfig(),
    requestConfirmation: async () => false,
  });
  assert.equal(executed.length, 0);
  const item = result.trace.find((t) => t.tool === "test_tool");
  assert.match(String(item.result.error), /did not confirm .*security risk UNKNOWN/);
});

test("run-agent gate: no confirmation channel → blocked with a clear error", async () => {
  const { executed, result } = await runMockAgent({
    globalConfig: baseConfig(),
    requestConfirmation: null,
  });
  assert.equal(executed.length, 0);
  const item = result.trace.find((t) => t.tool === "test_tool");
  assert.match(String(item.result.error), /requires user confirmation/);
});

test("run-agent gate: in total mode the risk gate is a HIGH-only safety floor", async () => {
  // Mock emits no grade → UNKNOWN. In total, confirm_unknown is forced off and
  // confirm_at forced to HIGH, so an ungraded/low call runs free…
  const c1 = [];
  const r1 = await runMockAgent({
    globalConfig: baseConfig({ permission_mode: "total" }),
    requestConfirmation: async () => { c1.push(1); return true; },
  });
  assert.equal(c1.length, 0, "ungraded call runs free under total");
  assert.equal(r1.executed.length, 1);

  // …but a HIGH-graded call still stops even in total (the safety floor).
  const c2 = [];
  const r2 = await runMockAgent({
    globalConfig: baseConfig({ permission_mode: "total" }),
    requestConfirmation: async (t, _a, d) => { c2.push(d); return false; },
    handler: async () => ({ ok: true }),
    riskArg: "HIGH",
  });
  assert.equal(c2.length, 1, "HIGH action confirms even under total");
  assert.equal(r2.executed.length, 0, "declined HIGH action is blocked");
});

test("run-agent gate: disabled analyzer leaves calls ungated", async () => {
  const confirmations = [];
  const { executed, result } = await runMockAgent({
    globalConfig: baseConfig({ security_risk: { enabled: false } }),
    requestConfirmation: async () => { confirmations.push(1); return true; },
  });
  assert.equal(confirmations.length, 0);
  assert.equal(executed.length, 1);
  const item = result.trace.find((t) => t.tool === "test_tool");
  assert.equal(item.security_risk, undefined);
});
