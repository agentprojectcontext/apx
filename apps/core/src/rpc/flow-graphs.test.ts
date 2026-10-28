import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    { id: "start", kind: "webhook", label: "Webhook" },
    { id: "save", kind: "table_write", label: "Save", key: "latest", value: { kind: "event", path: [] } },
  ],
  edges: [{ source: "start", target: "save" }],
  layout: [],
};

test("graph management uses owner-only HTTP/WS protocol, CAS, project binding validation and no execution", async () => {
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.create", { name: "Project" })).project.id;
    const legacy = {
      id: "visual",
      projectId: project,
      name: "Visual",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
    };
    await env.client.call("flows.set", legacy);
    assert.equal((await env.client.call("flows.graph_get", { flow: "visual" })).draft, null);
    await env.client.call("flows.draft_save", { flow: "visual", expectedVersion: null, graph });
    await assert.rejects(
      env.client.call("flows.publish", { flow: "visual", expectedDraftVersion: 1, expectedPublishedRevision: null }),
      /publication is unavailable/,
    );
    const attempts = await Promise.allSettled([
      env.client.call("flows.draft_save", { flow: "visual", expectedVersion: 1, graph }),
      env.client.call("flows.draft_save", { flow: "visual", expectedVersion: 1, graph }),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const invalid: FlowGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: "agent",
          kind: "agent",
          label: "Agent",
          agent: "missing",
          prompt: "Process",
          input: { kind: "event", path: [] },
        },
      ],
      edges: [...graph.edges, { source: "save", target: "agent" }],
    };
    const validated = await env.client.call("flows.validate", { flow: "visual", graph: invalid });
    assert.equal(validated.valid, false);
    assert.ok(validated.issues.some((issue) => issue.node === "agent" && issue.code === "binding_unavailable"));
    await env.client.call("flows.draft_save", { flow: "visual", expectedVersion: 2, graph: invalid });
    await env.client.call("flows.set", { ...legacy, enabled: false });
    await assert.rejects(
      env.client.call("flows.publish", { flow: "visual", expectedDraftVersion: 3, expectedPublishedRevision: null }),
      /publication is unavailable/,
    );
    await env.client.call("flows.draft_save", { flow: "visual", expectedVersion: 3, graph });
    const before = await env.client.call("flows.graph_get", { flow: "visual" });
    const socket = await env.client.connect();
    try {
      await assert.rejects(
        socket.call("flows.publish", {
          flow: "visual",
          expectedDraftVersion: 4,
          expectedPublishedRevision: null,
        }),
        /publication is unavailable/,
      );
      assert.deepEqual(await socket.call("flows.graph_get", { flow: "visual" }), before);
      assert.equal(before.publishedRevision, null);
      assert.deepEqual(before.draft, graph);
    } finally {
      socket.close();
      await socket.closed;
    }
    assert.equal((await env.client.call("flows.set", { ...legacy, enabled: true })).enabled, true);
    const external = await env.client.call("clients.create", { name: "Acme", scopes: ["chat"] });
    const outsider = new ApxClient({ url: env.core.url, clientToken: external.token });
    await assert.rejects(outsider.call("flows.graph_get", { flow: "visual" }), /outside/);
    await assert.rejects(outsider.call("flows.draft_save", { flow: "visual", expectedVersion: 4, graph }), /outside/);
    await assert.rejects(
      outsider.call("flows.publish", { flow: "visual", expectedDraftVersion: 4, expectedPublishedRevision: null }),
      /outside/,
    );
    await assert.rejects(outsider.call("flows.validate", { flow: "visual", graph }), /outside/);
    assert.equal(env.core.store.flows.events("visual", 10).length, 0);
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
