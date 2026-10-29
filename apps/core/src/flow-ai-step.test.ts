import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import { validateFlowGraph } from "./domain/flow-graph-validate.ts";
import { createPermissions } from "./engine/permissions.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { planFlowAiStep } from "./flow-ai-step.ts";
import type { LlmRequest } from "./providers/llm.ts";
import { waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
type Ai = Extract<FlowNode, { kind: "agent" }>;
const hook = { kind: "webhook" as const, id: "start", label: "Webhook" };
const ai = (fields: Partial<Ai>): Ai => ({
  id: "ask",
  kind: "agent",
  label: "Ask",
  prompt: "Sort this request.",
  input: { kind: "event", path: [] },
  ...fields,
});
const graphOf = (node: Ai): FlowGraph => ({
  schemaVersion: 2,
  nodes: [hook, node],
  edges: [{ source: "start", target: node.id }],
  layout: [],
});
const toolNames = (req: LlmRequest) => req.tools.map((t) => t.function.name);

async function runOnce(env: Env, id: string, node: Ai) {
  const project = (await env.client.call("projects.create", { name: `Project ${id}` })).project.id;
  await env.client.call("flows.set", {
    id,
    projectId: project,
    name: id,
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph: graphOf(node) });
  await env.client.call("flows.publish", {
    flow: id,
    expectedDraftVersion: draft.draftVersion ?? 0,
    expectedPublishedRevision: null,
  });
  const flow = env.core.store.flows.get(id);
  assert.ok(flow);
  await env.client.call("flows.set", { ...flow, enabled: true });
  const { event } = await env.client.call("flows.run_now", { flow: id, data: { text: "A lamp arrived broken" } });
  await waitFor(
    () => env.core.store.flows.events(id, 10).find((e) => e.event_id === event && e.state !== "pending"),
    "the run to end",
  );
  const step = env.core.store.flowGraphRuns.detail(id, event)?.steps.find((s) => s.node === node.id);
  assert.ok(step?.thread_id, "the step has its chat");
  return { step, thread: step.thread_id, context: env.core.store.threads.context(step.thread_id) };
}

test("an agent in a Flow keeps its tools but delegates to no one unless the step allows it", async () => {
  const llm = scriptedLlm(() => say("Sorted: refund"));
  const env = await startCore({ llm });
  try {
    const off = await runOnce(env, "solo", ai({ agent: "roby" }));
    assert.equal(off.step.state, "succeeded");
    assert.deepEqual(off.context.flow_step, { delegate: false });
    const offCall = llm.calls.at(-1);
    assert.ok(offCall);
    for (const name of ["delegate", "list_agents", "task_create", "task_comment"])
      assert.ok(!toolNames(offCall).includes(name), `${name} is left out`);
    assert.ok(toolNames(offCall).includes("remember"), "it keeps its memory");
    assert.ok(!String(offCall.messages[0]?.content).includes("[agents]"), "no roster to hand work to");

    const on = await runOnce(
      env,
      "team",
      ai({ agent: "roby", delegate: true, model: "fake/fake-1", autonomy: "total" }),
    );
    assert.equal(on.step.state, "succeeded");
    assert.deepEqual(on.context.flow_step, { delegate: true, autonomy: "total" });
    assert.deepEqual(on.context.model_choice, { model: "fake/fake-1", router: false });
    const onCall = llm.calls.at(-1);
    assert.ok(onCall && toolNames(onCall).includes("delegate"), "the step allowed delegating");
    assert.equal(onCall.models[0], "fake/fake-1");
    const runs = await env.client.call("flows.events", { flow: "team" });
    const detail = await env.client.call("flows.run_get", { flow: "team", event: runs.events[0]?.event_id ?? "" });
    const shown = detail.steps.find((s) => s.node === "ask");
    assert.deepEqual(shown?.answered, { harness: "native", model: "fake/fake-1" });
    assert.equal(shown?.thread_id, on.thread);
    const roby = env.core.store.agents.get("roby");
    assert.ok(roby);
    const permissions = createPermissions({ store: env.core.store, home: "" });
    assert.equal(permissions.agentIn(roby, on.thread).autonomy, "total");
    // A helper it hands work to works in the step's mode, not the agent's own.
    const solo = await runOnce(env, "careful", ai({ agent: "roby", delegate: true, autonomy: "manual" }));
    const helper = env.core.store.threads.create({
      kind: "a2a",
      title: "Helper",
      agent_ids: ["roby"],
      parent_id: solo.thread,
    });
    assert.equal(permissions.agentIn(roby, helper.id).autonomy, "manual");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a bot of the Flow answers with its own system prompt, no memory and no team", async () => {
  const llm = scriptedLlm(() => say("Category: damage"));
  const env = await startCore({ llm });
  try {
    const bot = { name: "Triage", system: "Label each request with one category from: damage, billing, other." };
    const { step, context } = await runOnce(env, "triage", ai({ bot }));
    assert.equal(step.state, "succeeded");
    assert.equal(JSON.parse(step.output ?? "{}").text, "Category: damage");
    assert.deepEqual(context.flow_step, { delegate: false, bot: true });
    assert.deepEqual(context.worker, { name: "Triage", instructions: bot.system });
    const call = llm.calls.at(-1);
    assert.ok(call);
    const system = String(call.messages[0]?.content);
    assert.ok(system.startsWith("You are Triage, a bot"), "it speaks as the bot");
    assert.ok(system.includes(bot.system));
    // It speaks through the super-agent, but reaches none of the owner's chats, accounts, memory or team.
    for (const name of [
      "delegate",
      "remember",
      "recall",
      "agent_set",
      "apx_settings",
      "apx_flow",
      "read_chat",
      "search_chats",
      "search_owner_notes",
      "message_contact",
      "mcp_search",
    ])
      assert.ok(!toolNames(call).includes(name), `${name} is left out`);
    assert.ok(toolNames(call).includes("web_search"), "it keeps the tools that work on the task");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an AI step names an agent or a bot, with the permission mode of its harness", () => {
  const codes = (node: Ai) => validateFlowGraph(graphOf(node)).map((i) => i.code);
  assert.ok(codes(ai({})).includes("ai_source"));
  assert.ok(codes(ai({ agent: "roby", bot: { name: "B", system: "S" } })).includes("ai_source"));
  assert.ok(!codes(ai({ agent: "roby", autonomy: "auto", delegate: true })).includes("ai_mode"));
  assert.ok(codes(ai({ agent: "roby", write: "auto" })).includes("ai_mode"), "APX's harness has no write mode");
  assert.ok(codes(ai({ agent: "roby", model: "claude", autonomy: "total" })).includes("ai_mode"));
  assert.ok(codes(ai({ agent: "roby", model: "codex", delegate: true })).includes("ai_mode"));
  assert.ok(!codes(ai({ agent: "roby", model: "claude/opus", write: "read-only" })).includes("ai_mode"));
  assert.ok(codes(ai({ bot: { name: "B", system: "S" }, delegate: true })).includes("ai_mode"));
});

test("a CLI harness runs the agent's or the bot's brief in its own session, with the write mode picked", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
    const plan = planFlowAiStep(
      env.core.store,
      project,
      ai({ bot: { name: "Fixer", system: "Fix lint errors only." }, model: "claude/opus#high", write: "read-only" }),
      { file: "a.ts" },
    );
    assert.ok(plan);
    assert.equal(plan.engine, "claude");
    assert.equal(plan.write, "read-only");
    assert.deepEqual(plan.context.model_choice, { model: "claude/opus#high", router: false });
    assert.ok(plan.text.startsWith("You are Fixer.") && plan.text.includes("Fix lint errors only."));
    assert.ok(plan.text.endsWith('Untrusted input JSON:\n{"file":"a.ts"}'));
    // The APX tools a CLI reaches follow the step's limits too.
    assert.deepEqual(plan.context.flow_step, { delegate: false, bot: true });
    const agent = planFlowAiStep(env.core.store, project, ai({ agent: "roby", model: "codex" }), null);
    assert.deepEqual(agent?.context.flow_step, { delegate: false });
    assert.equal(agent?.engine, "codex");
    assert.ok(agent?.text.includes("You work as"));
    assert.equal(planFlowAiStep(env.core.store, project, ai({ agent: "nobody" }), null), undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a CLI step needs the project's folder: a project without one is told before it runs", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.create", { name: "Elsewhere" })).project.id;
    const record = env.core.store.projects.get(project);
    assert.ok(record);
    env.core.store.projects.upsert({ ...record, present: false });
    const { issues } = await env.client.call("flows.validate", {
      project,
      graph: graphOf(ai({ agent: "roby", model: "claude" })),
    });
    assert.ok(issues.some((i) => i.code === "folder_unavailable" && i.node === "ask"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
