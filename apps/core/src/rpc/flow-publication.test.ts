import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const graphs: FlowGraph[] = [
  { schemaVersion: 2, nodes: [{ id: "start", kind: "webhook", label: "Webhook" }], edges: [], layout: [] },
  {
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "webhook", label: "Webhook" },
      { id: "save", kind: "table_write", label: "Save", key: "latest", value: { kind: "event", path: [] } },
    ],
    edges: [{ source: "start", target: "save" }],
    layout: [],
  },
  {
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "webhook", label: "Webhook" },
      {
        id: "agent",
        kind: "agent",
        label: "Agent",
        agent: "superagent",
        prompt: "Process",
        input: { kind: "event", path: [] },
      },
    ],
    edges: [{ source: "start", target: "agent" }],
    layout: [],
  },
];

test("HTTP and WS publish each drawing as a new revision without touching legacy data or waking events", async () => {
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.create", { name: "Project" })).project.id;
    const definition = {
      id: "guarded",
      projectId: project,
      name: "Guarded",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
    };
    const legacy = await env.client.call("flows.set", definition);
    assert.equal(env.core.store.flows.receive(legacy.id, "original", { text: "Original" }), "written");
    await env.client.call("flows.set", { ...legacy, enabled: false });
    const beforeLegacy = env.core.store.flows.get(legacy.id);
    const beforeRows = env.core.store.flows.rows(legacy.id, 10);
    const socket = await env.client.connect();
    let revision: number | null = null;
    try {
      for (const graph of graphs) {
        for (const client of [env.client, socket]) {
          const previous = await client.call("flows.graph_get", { flow: legacy.id });
          // A second client publishing the same drawing finds nothing new to publish.
          const saved: { draftVersion: number | null } = await client.call("flows.draft_save", {
            flow: legacy.id,
            expectedVersion: previous.draftVersion,
            graph: { ...graph, layout: [{ node: "start", x: revision ?? 0, y: client === socket ? 1 : 0 }] },
          });
          const params: { flow: string; expectedDraftVersion: number; expectedPublishedRevision: number | null } = {
            flow: legacy.id,
            expectedDraftVersion: saved.draftVersion ?? 0,
            expectedPublishedRevision: revision,
          };
          const published: { publishedRevision: number | null; draft: unknown } = await client.call(
            "flows.publish",
            params,
          );
          assert.equal(published.publishedRevision, (revision ?? 0) + 1);
          assert.equal(published.draft, null);
          await assert.rejects(client.call("flows.publish", params), (error: unknown) => {
            assert.ok(error instanceof ApxError);
            assert.equal(error.code, "conflict");
            return true;
          });
          revision = published.publishedRevision;
          assert.deepEqual(env.core.store.flows.get(legacy.id), beforeLegacy);
          assert.deepEqual(env.core.store.flows.rows(legacy.id, 10), beforeRows);
          assert.deepEqual(
            env.core.store.flows.events(legacy.id, 10).map((e) => [e.event_id, e.state]),
            [["original", "written"]],
          );
        }
      }
    } finally {
      socket.close();
      await socket.closed;
    }
    assert.equal(revision, graphs.length * 2);
    // Only the switch and name change on a published Flow; its old definition stays as history.
    await assert.rejects(env.client.call("flows.set", { ...legacy, tableKey: "other" }), /drawing/);
    await env.client.call("flows.set", legacy);
    assert.equal(
      env.core.store.flows.receive(legacy.id, "original", { text: "Replacement" }, () => {}),
      "duplicate",
    );
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
