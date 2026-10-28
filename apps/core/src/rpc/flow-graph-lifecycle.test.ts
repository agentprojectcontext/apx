import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "start", kind: "webhook", label: "Webhook" }],
  edges: [],
  layout: [],
};

test("explicit draft discard uses owner authorization and CAS across discard, recreation and restart", async () => {
  const home = tempDir();
  const llm = scriptedLlm(() => say("Must not run"));
  let env = await startCore({ home: home.path, llm });
  try {
    const project = (await env.client.call("projects.create", { name: "Project" })).project.id;
    const flow = {
      id: "accidental",
      projectId: project,
      name: "Accidental",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
    };
    const original = await env.client.call("flows.set", flow);
    env.core.store.flows.save({ ...original, enabled: true });
    assert.equal(env.core.store.flows.receive(flow.id, "retained", { text: "Event" }), "written");
    env.core.store.flows.save(original);
    const originalEvents = env.core.store.flows.events(flow.id, 10);
    await env.client.call("flows.write", { flow: flow.id, key: "kept", value: { text: "Original" } });
    await env.client.call("flows.draft_save", { flow: flow.id, expectedVersion: null, graph });
    const external = await env.client.call("clients.create", { name: "Acme", scopes: ["chat"] });
    const outsider = new ApxClient({ url: env.core.url, clientToken: external.token });
    await assert.rejects(
      outsider.call("flows.draft_discard", { flow: flow.id, expectedVersion: 1, confirm: true }),
      /outside/,
    );
    await assert.rejects(
      env.client.call("flows.retire", { flow: flow.id, confirm: true, exported: true }),
      /unpublished changes/,
    );
    await env.client.call("flows.draft_save", { flow: flow.id, expectedVersion: 1, graph });
    await assert.rejects(
      env.client.call("flows.draft_discard", { flow: flow.id, expectedVersion: 1, confirm: true }),
      /changed/,
    );
    const socket = await env.client.connect();
    try {
      const discarded = await socket.call("flows.draft_discard", { flow: flow.id, expectedVersion: 2, confirm: true });
      assert.equal(discarded.draft, null);
      assert.equal(discarded.draftVersion, 3);
      assert.equal(discarded.publishedRevision, null);
    } finally {
      socket.close();
      await socket.closed;
    }
    await env.core.close();
    env = await startCore({ home: home.path, llm });
    const reopened = await env.client.call("flows.graph_get", { flow: flow.id });
    assert.equal(reopened.draft, null);
    assert.equal(reopened.draftVersion, 3);
    await assert.rejects(
      env.client.call("flows.draft_save", { flow: flow.id, expectedVersion: null, graph }),
      /changed/,
    );
    await env.client.call("flows.draft_save", { flow: flow.id, expectedVersion: 3, graph });
    await assert.rejects(
      env.client.call("flows.draft_discard", { flow: flow.id, expectedVersion: 2, confirm: true }),
      /changed/,
    );
    assert.equal((await env.client.call("flows.graph_get", { flow: flow.id })).draftVersion, 4);
    await env.client.call("flows.draft_discard", { flow: flow.id, expectedVersion: 4, confirm: true });
    assert.deepEqual(env.core.store.flows.get(flow.id), original);
    assert.deepEqual(env.core.store.flows.events(flow.id, 10), originalEvents);
    assert.deepEqual(env.core.store.flows.rows(flow.id, 10), [
      { key: "kept", value: { text: "Original" } },
      { key: "latest", value: { text: "Event" } },
    ]);
    assert.equal(llm.calls.length, 0);
    assert.equal(
      (await env.client.call("flows.retire", { flow: flow.id, confirm: true, exported: true })).retired,
      true,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
  }
});

test("a refused publication changes nothing; a published Flow retires with no extra step once off and idle", async () => {
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.create", { name: "Project" })).project.id;
    await env.client.call("flows.set", {
      id: "retained",
      projectId: project,
      name: "Retained",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const unknown: FlowGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: "think",
          kind: "llm",
          label: "Think",
          model: "nowhere/none",
          prompt: "Summarize",
          input: { kind: "event", path: [] },
          maxOutputTokens: 100,
          timeoutMs: 5000,
        },
      ],
      edges: [{ source: "start", target: "think" }],
    };
    await env.client.call("flows.draft_save", { flow: "retained", expectedVersion: null, graph: unknown });
    const saved = await env.client.call("flows.graph_get", { flow: "retained" });
    await assert.rejects(
      env.client.call("flows.publish", { flow: "retained", expectedDraftVersion: 1, expectedPublishedRevision: null }),
      /model is not set up/,
    );
    assert.deepEqual(await env.client.call("flows.graph_get", { flow: "retained" }), saved);
    await env.client.call("flows.draft_save", { flow: "retained", expectedVersion: 1, graph });
    const published = await env.client.call("flows.publish", {
      flow: "retained",
      expectedDraftVersion: 2,
      expectedPublishedRevision: null,
    });
    assert.equal(published.publishedRevision, 1);
    assert.equal(published.draft, null);
    assert.equal(env.core.store.flows.events("retained", 10).length, 0);
    assert.equal(
      (await env.client.call("flows.retire", { flow: "retained", confirm: true, exported: true })).retired,
      true,
    );
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
