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
        agent: "roby",
        prompt: "Process",
        input: { kind: "event", path: [] },
      },
    ],
    edges: [{ source: "start", target: "agent" }],
    layout: [],
  },
];

test("HTTP and WS reject every non-LLM graph publication without changing drafts or legacy state", async () => {
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
    const beforeEvents = env.core.store.flows.events(legacy.id, 10);
    const socket = await env.client.connect();
    try {
      for (const graph of graphs) {
        const previous = await env.client.call("flows.graph_get", { flow: legacy.id });
        const saved = await env.client.call("flows.draft_save", {
          flow: legacy.id,
          expectedVersion: previous.draftVersion,
          graph,
        });
        assert.ok(saved.draftVersion);
        assert.equal((await env.client.call("flows.validate", { flow: legacy.id, graph })).valid, true);
        const params = { flow: legacy.id, expectedDraftVersion: saved.draftVersion, expectedPublishedRevision: null };
        for (const client of [env.client, socket]) {
          await assert.rejects(client.call("flows.publish", params), (error: unknown) => {
            assert.ok(error instanceof ApxError);
            assert.equal(error.code, "conflict");
            assert.equal(error.retryable, false);
            assert.deepEqual(error.detail, { reason: "graph_execution_unavailable" });
            assert.match(error.message, /publication is unavailable/);
            return true;
          });
          assert.deepEqual(await client.call("flows.graph_get", { flow: legacy.id }), saved);
          assert.deepEqual(env.core.store.flows.get(legacy.id), beforeLegacy);
          assert.deepEqual(env.core.store.flows.rows(legacy.id, 10), beforeRows);
          assert.deepEqual(env.core.store.flows.events(legacy.id, 10), beforeEvents);
        }
      }
    } finally {
      socket.close();
      await socket.closed;
    }
    await env.client.call("flows.set", legacy);
    assert.equal(env.core.store.flows.receive(legacy.id, "original", { text: "Replacement" }), "duplicate");
    assert.equal(env.core.store.flows.receive(legacy.id, "next", { text: "Next" }), "written");
    assert.deepEqual(env.core.store.flows.rows(legacy.id, 10)[0]?.value, { text: "Next" });
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
