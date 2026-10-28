import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    { id: "start", kind: "webhook", label: "Webhook" },
    { id: "first", kind: "table_write", label: "First", key: "latest", value: { kind: "literal", value: 1 } },
    { id: "second", kind: "table_write", label: "Second", key: "latest", value: { kind: "literal", value: 2 } },
  ],
  edges: [
    { source: "start", target: "first" },
    { source: "start", target: "second" },
  ],
  layout: [],
};

test("HTTP and WS validate explicit write dependencies without executing or altering legacy data", async () => {
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.create", { name: "Project" })).project.id;
    const legacy = await env.client.call("flows.set", {
      id: "dependencies",
      projectId: project,
      name: "Dependencies",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    assert.equal(env.core.store.flows.receive(legacy.id, "existing", { value: "original" }), "written");
    const before = {
      definition: env.core.store.flows.get(legacy.id),
      rows: env.core.store.flows.rows(legacy.id, 10),
      events: env.core.store.flows.events(legacy.id, 10),
    };
    const socket = await env.client.connect();
    try {
      for (const client of [env.client, socket]) {
        const invalid = await client.call("flows.validate", { flow: legacy.id, graph });
        assert.equal(invalid.valid, false);
        assert.deepEqual(
          invalid.issues.map((issue) => issue.code),
          ["unordered_write"],
        );
        const ordered = await client.call("flows.validate", {
          flow: legacy.id,
          graph: { ...graph, edges: [...graph.edges, { source: "first", target: "second" }] },
        });
        assert.deepEqual(ordered, { valid: true, issues: [] });
      }
      const saved = await env.client.call("flows.draft_save", { flow: legacy.id, expectedVersion: null, graph });
      assert.equal(saved.executionAvailable, false);
      assert.deepEqual(saved.draft, graph);
      assert.ok(saved.draftVersion);
      for (const client of [env.client, socket]) {
        await assert.rejects(
          client.call("flows.publish", {
            flow: legacy.id,
            expectedDraftVersion: saved.draftVersion,
            expectedPublishedRevision: null,
          }),
          /publication is unavailable/,
        );
        assert.deepEqual(await client.call("flows.graph_get", { flow: legacy.id }), saved);
      }
    } finally {
      socket.close();
      await socket.closed;
    }
    assert.deepEqual(
      {
        definition: env.core.store.flows.get(legacy.id),
        rows: env.core.store.flows.rows(legacy.id, 10),
        events: env.core.store.flows.events(legacy.id, 10),
      },
      before,
    );
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
