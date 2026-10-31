// A step's settings read back in words for the chat's view of a Flow.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { type FactsContext, nextSteps, stepFacts } from "./step-facts.ts";

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars)})` : key);
const graph = (nodes: FlowNode[], edges: FlowGraph["edges"] = []): FlowGraph => ({
  schemaVersion: 2,
  nodes,
  edges,
  layout: [],
});
const ctx = (g: FlowGraph): FactsContext => ({
  graph: g,
  who: (n) => (n.kind === "agent" ? (n.bot?.name ?? "") : ""),
  scheduleName: (cron) => cron,
  modelName: (ref) => (ref === "gemini/flash#low" ? "Flash · Low" : "?"),
});

const hook: FlowNode = { id: "start", label: "Form sent", kind: "webhook" };
const ai: FlowNode = {
  id: "reply",
  label: "Write the reply",
  kind: "agent",
  bot: { name: "Helper", system: "Be brief." },
  model: "gemini/flash#low",
  prompt: "Answer the question.",
  input: { kind: "node", node: "start", path: ["question"] },
};

test("an AI step reads as who answers, its model by name, its instruction and what it receives", () => {
  const g = graph([hook, ai]);
  assert.deepEqual(stepFacts(ai, ctx(g), t), [
    { label: "flow.ai.botName", value: "Helper" },
    { label: "flow.ai.system", value: "Be brief." },
    { label: "flow.f.model", value: "Flash · Low" },
    { label: "flow.f.task", value: "Answer the question." },
    { label: "flow.f.receives", value: "$steps.start.question", code: true },
  ]);
  // Everything that arrived is said in words, not as a placeholder.
  const whole = { ...ai, input: { kind: "event" as const, path: [] } };
  assert.deepEqual(stepFacts(whole, ctx(g), t).at(-1), { label: "flow.f.receives", value: "flow.v.everything" });
});

test("settings left empty are not listed", () => {
  const call: FlowNode = {
    id: "call",
    label: "Call",
    kind: "http",
    method: "GET",
    url: "https://example.com/api",
    headers: [],
    body: "",
    timeoutMs: 10000,
  };
  assert.deepEqual(
    stepFacts(call, ctx(graph([call])), t).map((f) => f.label),
    ["flow.f.method", "flow.f.address"],
  );
});

test("a check lists each case by its way out, then what happens otherwise", () => {
  const check: FlowNode = {
    id: "vip",
    label: "Is it a VIP?",
    kind: "condition",
    input: { kind: "event", path: ["plan"] },
    equals: "pro",
  };
  assert.deepEqual(stepFacts(check, ctx(graph([check])), t), [
    { label: "flow.f.yes", value: '$trigger.plan = "pro"', code: true },
    { label: "flow.f.no", value: "flow.f.otherwiseHint" },
  ]);
});

test("where a step goes on to names the way out of a check", () => {
  const check: FlowNode = {
    id: "vip",
    label: "Is it a VIP?",
    kind: "condition",
    input: { kind: "event", path: ["plan"] },
    equals: "pro",
  };
  const g = graph(
    [hook, check, ai],
    [
      { source: "start", target: "vip" },
      { source: "vip", target: "reply", when: "yes" },
    ],
  );
  assert.deepEqual(nextSteps(g, hook, t), [{ id: "vip", label: "Is it a VIP?" }]);
  assert.deepEqual(nextSteps(g, check, t), [{ id: "reply", label: "Write the reply", when: "flow.f.yes" }]);
  assert.deepEqual(nextSteps(g, ai, t), []);
});
