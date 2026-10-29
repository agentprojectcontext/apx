// A project's tables on their own (DECISIONS.md#d-176): made empty, with columns the owner adds, renames and removes,
// read empty by a run, filled column by column, and reached by the super-agent without a Flow.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import { callTool, say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createLog } from "./log.ts";
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
const output = (env: Env, flow: string, id: string, node: string) =>
  JSON.parse(env.core.store.flowGraphRuns.detail(flow, id)?.steps.find((s) => s.node === node)?.output ?? "null");
const project = async (env: Env, name: string) => (await env.client.call("projects.create", { name })).project.id;

test("a table is made empty; its columns are added, renamed and removed, in every row too", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const p = await project(env, "Acme");
    const made = await env.client.call("tables.create", { project: p, name: "leads", columns: ["email"] });
    assert.deepEqual([made.table.columns, made.table.rows], [["email"], 0]);
    assert.deepEqual((await env.client.call("tables.get", { project: p, table: "leads" })).rows, []);
    await assert.rejects(env.client.call("tables.create", { project: p, name: "leads" }), /already exists/);
    await env.client.call("tables.column_add", { project: p, table: "leads", column: "stage" });
    await env.client.call("tables.write", {
      project: p,
      table: "leads",
      key: "alex@example.com",
      values: { email: "alex@example.com", stage: "new" },
    });
    // A write changes the cells it names and keeps the others; a column it brings is added.
    await env.client.call("tables.write", {
      project: p,
      table: "leads",
      key: "alex@example.com",
      values: { stage: "won", score: 3 },
    });
    let got = await env.client.call("tables.get", { project: p, table: "leads" });
    assert.deepEqual(got.table.columns, ["email", "stage", "score"]);
    assert.deepEqual(got.rows[0]?.value, { email: "alex@example.com", stage: "won", score: 3 });
    await env.client.call("tables.column_rename", { project: p, table: "leads", column: "stage", name: "status" });
    await env.client.call("tables.column_remove", { project: p, table: "leads", column: "score" });
    got = await env.client.call("tables.get", { project: p, table: "leads" });
    assert.deepEqual(got.table.columns, ["email", "status"]);
    assert.deepEqual(got.rows[0]?.value, { email: "alex@example.com", status: "won" });
    await assert.rejects(
      env.client.call("tables.column_add", { project: p, table: "leads", column: "rows" }),
      /invalid params/,
    );
    await env.client.call("tables.rename", { project: p, table: "leads", name: "clients" });
    assert.equal((await env.client.call("tables.get", { project: p, table: "clients" })).rows.length, 1);
    await assert.rejects(env.client.call("tables.get", { project: p, table: "leads" }), /Table not found/);
    assert.equal(
      (await env.client.call("tables.delete_rows", { project: p, table: "clients", keys: ["alex@example.com"] }))
        .deleted,
      1,
    );
    assert.equal((await env.client.call("tables.remove", { project: p, table: "clients" })).removed, true);
    assert.deepEqual((await env.client.call("tables.list", { project: p })).tables, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a run reads an empty table as nothing, and a save fills columns that a later read gives as $steps.read.<column>", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const p = await project(env, "Acme runs");
    await env.client.call("tables.create", { project: p, name: "leads", columns: ["name", "email", "score"] });
    await env.client.call("tables.create", { project: p, name: "seen", columns: ["who"] });
    // Empty: the read succeeds with no rows and its columns empty; a save that reads one keeps it empty.
    const latest: FlowNode = { id: "read", kind: "table_read", label: "Read", table: "leads", keys: [], latest: 5 };
    const note: FlowNode = {
      id: "note",
      kind: "table_write",
      label: "Note",
      table: "seen",
      key: "last",
      columns: [{ name: "who", value: "$steps.read.name" }],
    };
    await publish(env, "empty", p, chain(hook, latest, note));
    assert.equal((await post(env, "empty", "e1", { go: true })).state, "succeeded");
    assert.deepEqual(output(env, "empty", "e1", "read"), { name: null, email: null, score: null, rows: [] });
    assert.deepEqual(env.core.store.flowTables.read(p, "seen", ["last"]), { last: { who: null } });

    // A save by column: one placeholder alone keeps its value as it is, text around it makes text.
    await env.client.call("tables.write", {
      project: p,
      table: "leads",
      key: "sam@example.com",
      values: { score: 1, stage: "new" },
    });
    const save: FlowNode = {
      id: "save",
      kind: "table_write",
      label: "Save",
      table: "leads",
      key: "$trigger.email",
      columns: [
        { name: "name", value: "Lead $trigger.name" },
        { name: "email", value: "$trigger.email" },
        { name: "score", value: "$trigger.score" },
      ],
    };
    const one: FlowNode = { id: "one", kind: "table_read", label: "One", table: "leads", keys: ["$trigger.email"] };
    await publish(env, "fill", p, chain(hook, save, one));
    assert.equal(
      (await post(env, "fill", "e1", { email: "sam@example.com", name: "Sam", score: 7 })).state,
      "succeeded",
    );
    const read = output(env, "fill", "e1", "one");
    assert.deepEqual(
      [read.name, read.email, read.score],
      ["Lead Sam", "sam@example.com", 7],
      "the read gives the row's columns",
    );
    // The owner's column the save does not fill stays.
    assert.equal(read.row.stage, "new");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a step naming a table that was renamed or removed is an issue, and its Flow stops instead of failing a step", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const p = await project(env, "Acme gone");
    await env.client.call("tables.create", { project: p, name: "leads", columns: ["email"] });
    const save: FlowNode = {
      id: "save",
      kind: "table_write",
      label: "Save",
      table: "leads",
      key: "$trigger.email",
      columns: [{ name: "email", value: "$trigger.email" }],
    };
    const graph = chain(hook, save);
    await publish(env, "gone", p, graph);
    const codes = async (g: FlowGraph) =>
      (await env.client.call("flows.validate", { flow: "gone", graph: g })).issues.map((i) => i.code);
    await env.client.call("tables.column_remove", { project: p, table: "leads", column: "email" });
    assert.deepEqual(await codes(graph), ["column_missing"]);
    await env.client.call("tables.rename", { project: p, table: "leads", name: "people" });
    assert.deepEqual(await codes(graph), ["table_missing"]);
    // The Flow refuses what arrives until the owner picks a table again; nothing is saved anywhere.
    const route = env.core.flows.routes("/flows/gone");
    const refused = await route?.handle(
      {
        method: "POST",
        path: "/flows/gone",
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ id: "e1", data: { email: "a@example.com" } })),
      },
      new AbortController().signal,
    );
    assert.equal(refused?.status, 400);
    assert.deepEqual(env.core.store.flows.events("gone", 10), []);
    assert.equal((await env.client.call("tables.get", { project: p, table: "people" })).rows.length, 0);
    // A save with neither a value nor columns says what it lacks.
    const { value: _v, ...bare } = { ...save, columns: undefined, value: undefined };
    assert.ok((await codes(chain(hook, bare as FlowNode))).includes("save_what"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

/** A core whose model makes the apx_flow calls the owner's message lists, one after another. */
async function agentCore() {
  const llm = scriptedLlm((req, { said }) => {
    const calls = JSON.parse(said.startsWith("[") ? said : "[]") as object[];
    const done = req.messages.filter((m) => m.role === "tool").length;
    const next = calls[done];
    return next ? callTool(`c${done}`, "apx_flow", next) : say(String(req.messages.at(-1)?.content));
  });
  const env = await startCore({ llm });
  const ask = async (calls: object[], decision?: "approve" | "deny") => {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Tables" });
    await env.client.call("threads.send", { thread: thread.id, text: JSON.stringify(calls) });
    let asked = false;
    if (decision) {
      const pending = await waitFor(
        async () => (await env.client.call("runs.pending", { thread: thread.id })).inputs[0],
        "the owner to be asked",
      );
      asked = pending.tool === "apx_flow";
      await env.client.call("runs.respond", { input: pending.id, decision });
    }
    await env.settle(thread.id);
    const left = (await env.client.call("runs.pending", { thread: thread.id })).inputs.length;
    return { asked, left, answer: String(llm.calls.at(-1)?.messages.at(-1)?.content) };
  };
  return { env, ask };
}

test("the super-agent fills a table without a Flow; with outside content in the turn it asks first", async () => {
  const { env, ask } = await agentCore();
  try {
    const p = await project(env, "Acme agent");
    const make = { method: "tables.create", params: { project: p, name: "leads", columns: ["name"] } };
    const add = (key: string) => ({
      method: "tables.write",
      params: { project: p, table: "leads", key, values: { name: "Alex", email: key } },
    });
    // The owner's own words: nothing waits for them.
    const plain = await ask([make, add("alex@example.com")]);
    assert.equal(plain.left, 0);
    const got = await env.client.call("tables.get", { project: p, table: "leads" });
    assert.deepEqual(got.table.columns, ["name", "email"]);
    assert.equal(got.rows[0]?.key, "alex@example.com");
    // Its rows are outside content: a write after reading them asks, and a no keeps the table as it was.
    const read = { method: "tables.get", params: { project: p, table: "leads" } };
    const outside = await ask([read, add("sam@example.com")], "deny");
    assert.equal(outside.asked, true);
    assert.equal((await env.client.call("tables.get", { project: p, table: "leads" })).rows.length, 1);
    // Removing a table always waits for the owner.
    const remove = await ask([{ method: "tables.remove", params: { project: p, table: "leads" } }], "deny");
    assert.equal(remove.asked, true);
    assert.equal((await env.client.call("tables.list", { project: p })).tables.length, 1);
    // A table that isn't there is said in words the model acts on.
    const missing = await ask([{ method: "tables.get", params: { project: p, table: "nope" } }]);
    assert.match(missing.answer, /make it with tables\.create/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an agent of one project reaches only its tables", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const acme = await project(env, "Acme");
    const northwind = await project(env, "Northwind");
    await env.client.call("tables.create", { project: northwind, name: "deals" });
    const writer = await env.client.call("agents.create", { project_id: acme, slug: "acme-writer", name: "Writer" });
    const as = {
      actor: "agent" as const,
      agent: { id: writer.id, run_id: "run-test", thread_id: "thread-test" },
      transport: "internal" as const,
      role: "operator" as const,
      session: undefined,
      log: createLog("test", true),
    };
    const away = await env.core.dispatch("tables.get", { project: northwind, table: "deals" }, as);
    assert.ok(!away.ok && away.error.code === "not_found");
    const listed = await env.core.dispatch("tables.list", {}, as);
    assert.ok(listed.ok);
    assert.deepEqual((listed.result as { tables: unknown[] }).tables, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
