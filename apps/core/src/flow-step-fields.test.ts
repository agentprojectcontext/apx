// A check's comparisons, a read that brings some columns and required columns, through the core
// (DECISIONS.md#d-180): what the editor sends is what runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const hook: FlowNode = { kind: "webhook", id: "start", label: "Webhook" };
const chain = (...nodes: FlowNode[]): FlowGraph => ({
  schemaVersion: 2,
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ source: nodes[i]?.id ?? "", target: n.id })),
  layout: [],
});

async function publish(env: Env, id: string, projectId: string, graph: FlowGraph) {
  await env.client.call("flows.set", {
    id,
    projectId,
    name: id,
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph });
  assert.deepEqual((await env.client.call("flows.validate", { flow: id, graph })).issues, []);
  await env.client.call("flows.publish", {
    flow: id,
    expectedDraftVersion: draft.draftVersion ?? 0,
    expectedPublishedRevision: null,
    outward: [],
  });
  const flow = env.core.store.flows.get(id);
  assert.ok(flow);
  await env.client.call("flows.set", { ...flow, enabled: true });
}
async function post(env: Env, flow: string, id: string, data: unknown) {
  const route = env.core.flows.routes(`/flows/${flow}`);
  assert.ok(route);
  await route.handle(
    {
      method: "POST",
      path: `/flows/${flow}`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ id, data })),
    },
    new AbortController().signal,
  );
  return waitFor(
    () => env.core.store.flows.events(flow, 50).find((e) => e.event_id === id && e.state !== "pending"),
    `run ${id} to end`,
    { ms: 30_000 },
  );
}
const step = (env: Env, flow: string, id: string, node: string) =>
  env.core.store.flowGraphRuns.detail(flow, id)?.steps.find((s) => s.node === node);
const project = async (env: Env, name: string) => (await env.client.call("projects.create", { name })).project.id;

test("a check of two comparisons joined by all routes a real run by what arrived", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const p = await project(env, "Acme checks");
    await env.client.call("tables.create", { project: p, name: "seen", columns: ["who"] });
    const check: FlowNode = {
      id: "check",
      label: "Check",
      kind: "condition",
      input: { kind: "event", path: [] },
      cases: [
        {
          id: "complete",
          label: "Complete",
          match: {
            kind: "all",
            rules: [
              { left: "$trigger.verified", op: "equals", right: "true", type: "boolean" },
              { left: "$trigger.email", op: "contains", right: "@", type: "text" },
            ],
          },
        },
      ],
    };
    const save: FlowNode = {
      id: "save",
      label: "Save",
      kind: "table_write",
      table: "seen",
      key: "$trigger.email",
      columns: [{ name: "who", value: "$trigger.email" }],
    };
    const graph: FlowGraph = {
      ...chain(hook, check, save),
      edges: [
        { source: "start", target: "check" },
        { source: "check", target: "save", when: "complete" },
      ],
    };
    await publish(env, "routes", p, graph);
    assert.equal((await post(env, "routes", "e1", { verified: true, email: "ana@example.com" })).state, "succeeded");
    assert.equal(step(env, "routes", "e1", "save")?.state, "succeeded");
    assert.equal((await post(env, "routes", "e2", { verified: "false", email: "bo@example.com" })).state, "succeeded");
    assert.equal(step(env, "routes", "e2", "save")?.state, "skipped");
    assert.deepEqual(Object.keys(env.core.store.flowTables.read(p, "seen", ["ana@example.com", "bo@example.com"])), [
      "ana@example.com",
    ]);
    // A comparison with nothing to compare with is unfinished: the draft keeps it, publishing names it.
    const open = structuredClone(graph);
    const c = open.nodes[1];
    if (c?.kind === "condition" && c.cases?.[0]?.match.kind === "all")
      c.cases[0].match.rules[1] = {
        left: "$trigger.email",
        op: "contains",
        right: "",
        type: "text",
      };
    const issues = (await env.client.call("flows.validate", { flow: "routes", graph: open })).issues;
    assert.deepEqual(
      issues.map((i) => [i.code, i.node]),
      [["step_incomplete", "check"]],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a read brings only the columns it chose, and a column it chose that goes away stops the Flow", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const p = await project(env, "Acme reads");
    await env.client.call("tables.create", { project: p, name: "leads", columns: ["name", "email", "phone"] });
    await env.client.call("tables.write", {
      project: p,
      table: "leads",
      key: "k1",
      values: { name: "Sam", email: "sam@example.com", phone: "555" },
    });
    const read: FlowNode = {
      id: "read",
      label: "Read",
      kind: "table_read",
      table: "leads",
      keys: ["k1"],
      columns: ["name", "phone"],
    };
    await publish(env, "picks", p, chain(hook, read));
    assert.equal((await post(env, "picks", "e1", { go: true })).state, "succeeded");
    const out = JSON.parse(step(env, "picks", "e1", "read")?.output ?? "null");
    assert.deepEqual(out, {
      name: "Sam",
      phone: "555",
      rows: { k1: { name: "Sam", phone: "555" } },
      row: { name: "Sam", phone: "555" },
    });
    // Without `columns` it brings every one, as before.
    const all = { ...read, columns: undefined };
    await publish(env, "every", p, chain(hook, all as FlowNode));
    assert.equal((await post(env, "every", "e1", { go: true })).state, "succeeded");
    assert.equal(JSON.parse(step(env, "every", "e1", "read")?.output ?? "null").email, "sam@example.com");
    await env.client.call("tables.column_remove", { project: p, table: "leads", column: "phone" });
    const issues = (await env.client.call("flows.validate", { flow: "picks", graph: chain(hook, read) })).issues;
    assert.deepEqual(
      issues.map((i) => i.code),
      ["column_missing"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a required column: marked in the table, a save that leaves it empty is unfinished, refused or fails its step", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const p = await project(env, "Acme required");
    await env.client.call("tables.create", { project: p, name: "leads", columns: ["email", "phone", "note"] });
    const marked = await env.client.call("tables.column_required", {
      project: p,
      table: "leads",
      column: "phone",
      required: true,
    });
    assert.deepEqual(marked.table.required, ["phone"]);
    // The owner's own writes keep it too, naming the column.
    await assert.rejects(
      env.client.call("tables.write", { project: p, table: "leads", key: "a", values: { email: "a@example.com" } }),
      /required column phone/,
    );
    await env.client.call("tables.write", { project: p, table: "leads", key: "a", values: { phone: "555" } });
    await assert.rejects(
      env.client.call("tables.write", { project: p, table: "leads", key: "a", values: { phone: " " } }),
      /phone/,
    );
    // Renaming the column keeps it required; a save by column that doesn't fill it is unfinished.
    await env.client.call("tables.column_rename", { project: p, table: "leads", column: "phone", name: "mobile" });
    const save: FlowNode = {
      id: "save",
      label: "Save lead",
      kind: "table_write",
      table: "leads",
      key: "$trigger.email",
      columns: [{ name: "email", value: "$trigger.email" }],
    };
    const issues = (await env.client.call("flows.validate", { project: p, graph: chain(hook, save) })).issues;
    assert.deepEqual(
      issues.map((i) => [i.code, i.node]),
      [["step_incomplete", "save"]],
    );
    assert.match(issues[0]?.message ?? "", /mobile/);
    // Filled by a placeholder, the drawing runs; a run whose value comes out empty fails that step and names it.
    const filled: FlowNode = {
      ...save,
      columns: [...(save.columns ?? []), { name: "mobile", value: "$trigger.phone" }],
    };
    await publish(env, "leads", p, chain(hook, filled));
    assert.equal((await post(env, "leads", "e1", { email: "b@example.com", phone: "777" })).state, "succeeded");
    assert.equal((await post(env, "leads", "e2", { email: "c@example.com" })).state, "failed");
    const failed = step(env, "leads", "e2", "save");
    assert.equal(failed?.error, "required_empty");
    assert.deepEqual(JSON.parse(failed?.output ?? "null"), { required: ["mobile"] });
    assert.deepEqual(Object.keys(env.core.store.flowTables.read(p, "leads", ["b@example.com", "c@example.com"])), [
      "b@example.com",
    ]);
    // Not required any more: the same save goes through; removing the column forgets it.
    await env.client.call("tables.column_required", { project: p, table: "leads", column: "mobile", required: false });
    assert.equal((await post(env, "leads", "e3", { email: "d@example.com" })).state, "succeeded");
    await env.client.call("tables.column_required", { project: p, table: "leads", column: "note", required: true });
    await env.client.call("tables.column_remove", { project: p, table: "leads", column: "note" });
    assert.deepEqual((await env.client.call("tables.get", { project: p, table: "leads" })).table.required, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
