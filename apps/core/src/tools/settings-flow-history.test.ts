import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { createLog } from "../log.ts";
import { settingsCore } from "./settings.test-support.ts";
import { settingsTools } from "./settings.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
let acme = "";
before(async () => {
  h = await settingsCore();
  acme = (await h.env.client.call("projects.create", { name: "Acme" })).project.id;
  await h.env.client.call("tables.create", { project: acme, name: "leads" });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const drawing = (label: string): FlowGraph => ({
  schemaVersion: 2,
  nodes: [
    { id: "hook", kind: "webhook", label },
    {
      id: "save",
      kind: "table_write",
      label: "Save",
      table: "leads",
      key: "latest",
      value: { kind: "event", path: [] },
    },
  ],
  edges: [{ source: "hook", target: "save" }],
  layout: [],
});
const as = (agent: string) => ({
  actor: "agent" as const,
  agent: { id: agent, run_id: "run-test", thread_id: "thread-test" },
  transport: "internal" as const,
  role: "operator" as const,
  session: undefined,
  log: createLog("test", true),
});

test("the owner's saves, an agent's draft and a restore each leave an entry; restoring never publishes", async () => {
  const c = h.env.client;
  const made = await c.call("flows.create", { project: acme, name: "Leads", graph: drawing("One") });
  const flow = made.flow.id;
  const published = await c.call("flows.publish", {
    flow,
    expectedDraftVersion: 1,
    expectedPublishedRevision: null,
  });
  // The super-agent changes the draft from a chat.
  const answer = (
    await h.ask({
      method: "flows.draft_save",
      params: { flow, edits: [{ op: "update", step: "hook", set: { label: "Two" } }] },
    })
  ).answer;
  assert.match(answer, /^Saved the draft/);
  const listed = await c.call("flows.history", { flow });
  assert.deepEqual(
    listed.entries.map((e) => [e.entry, e.kind, e.by, e.byName, e.steps]),
    [
      [2, "draft", "roby", "Roby", 2],
      [1, "published", null, null, 2],
    ],
  );
  const doc = await c.call("flows.graph_get", { flow });
  const restored = await c.call("flows.history_restore", {
    flow,
    entry: 1,
    expectedVersion: doc.draftVersion,
    confirm: true,
  });
  // Entry 1 is what runs: nothing is left to publish, and what runs did not move.
  assert.equal(restored.publishedRevision, published.publishedRevision);
  assert.equal(restored.draft, null);
  // Bringing back the agent's entry keeps it waiting for the owner's review.
  const back = await c.call("flows.history_restore", {
    flow,
    entry: 2,
    expectedVersion: restored.draftVersion,
    confirm: true,
  });
  assert.equal(back.draft?.nodes[0]?.label, "Two");
  assert.equal(back.draftBy, "roby");
  assert.equal(back.publishedRevision, published.publishedRevision);
  const after = await c.call("flows.history", { flow });
  assert.deepEqual(
    after.entries.slice(0, 2).map((e) => [e.entry, e.kind, e.restoredFrom]),
    [
      [4, "restored", 2],
      [3, "restored", 1],
    ],
  );
  // A stale version is a conflict, never an overwrite.
  await assert.rejects(
    c.call("flows.history_restore", { flow, entry: 1, expectedVersion: restored.draftVersion, confirm: true }),
    /changed/,
  );
  await assert.rejects(c.call("flows.history_get", { flow, entry: 99 }), /no longer kept/);
});

test("the super-agent reads versions and what one drew, and can't bring one back", async () => {
  const c = h.env.client;
  const flow = (await c.call("flows.create", { project: acme, name: "Versions", graph: drawing("First") })).flow.id;
  const v = (await c.call("flows.draft_save", { flow, expectedVersion: 1, graph: drawing("Second") })).draftVersion;
  const list = JSON.parse((await h.ask({ method: "flows.history", params: { flow } })).answer) as {
    entries: { entry: number; kind: string }[];
  };
  assert.deepEqual(
    list.entries.map((e) => [e.entry, e.kind]),
    [
      [2, "draft"],
      [1, "draft"],
    ],
  );
  const one = JSON.parse((await h.ask({ method: "flows.history", params: { flow, entry: 1 } })).answer) as {
    graph: FlowGraph;
  };
  assert.equal(one.graph.nodes[0]?.label, "First");
  const refused = await h.env.core.dispatch(
    "flows.history_restore",
    { flow, entry: 1, expectedVersion: v, confirm: true },
    as("roby"),
    "k-restore",
  );
  assert.ok(!refused.ok && /reserved to the owner/.test(refused.error.message));
  assert.equal((await c.call("flows.graph_get", { flow })).draft?.nodes[0]?.label, "Second");
  // A version's drawing goes back to the model whole: asked with outside content around, as graph_get is.
  const [tool] = settingsTools(h.env.core.store);
  assert.equal(tool?.confirm({ method: "flows.history", params: { flow } }), "untrusted");
});
