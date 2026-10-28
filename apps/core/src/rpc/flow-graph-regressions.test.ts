import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    { id: "start", kind: "webhook", label: "Webhook" },
    { id: "save", kind: "table_write", label: "Save", key: "latest", value: { kind: "event", path: [] } },
  ],
  edges: [{ source: "start", target: "save" }],
  layout: [],
};

test("a rejected graph publication keeps legacy pending work resumable through the owner protocol", async () => {
  const folder = tempDir();
  const home = tempDir();
  const llm = scriptedLlm(() => say("Recovered"));
  let env = await startCore({ home: home.path, llm });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const flow = {
      id: "transition",
      projectId: project,
      name: "Transition",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "agent" as const, agent: "roby", prompt: "Summarize original event" },
    };
    await env.client.call("flows.set", flow);
    // Persist at the recovery boundary without waking the dispatcher before disabling.
    env.core.store.flows.save({ ...flow, enabled: true });
    assert.equal(env.core.store.flows.receive(flow.id, "one", { text: "original" }), "pending");
    await env.client.call("flows.set", flow);
    await env.client.call("flows.draft_save", { flow: flow.id, expectedVersion: null, graph });
    const before = env.core.store.flows.admissionInput(flow.id, "one");
    await assert.rejects(
      env.client.call("flows.publish", { flow: flow.id, expectedDraftVersion: 1, expectedPublishedRevision: null }),
      /publication is unavailable/,
    );
    assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    assert.equal((await env.client.call("flows.graph_get", { flow: flow.id })).publishedRevision, null);
    assert.equal(llm.calls.length, 0);
    await env.core.close();
    env = await startCore({ home: home.path, llm });
    assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    await assert.rejects(
      env.client.call("flows.publish", { flow: flow.id, expectedDraftVersion: 1, expectedPublishedRevision: null }),
      /publication is unavailable/,
    );
    assert.equal(llm.calls.length, 0);
    const pendingDocument = await env.client.call("flows.graph_get", { flow: flow.id });
    const pendingSocket = await env.client.connect();
    try {
      await assert.rejects(
        pendingSocket.call("flows.publish", {
          flow: flow.id,
          expectedDraftVersion: 1,
          expectedPublishedRevision: null,
        }),
        /publication is unavailable/,
      );
      assert.deepEqual(await pendingSocket.call("flows.graph_get", { flow: flow.id }), pendingDocument);
      assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    } finally {
      pendingSocket.close();
      await pendingSocket.closed;
    }
    env.core.store.flows.fail(flow.id, "one");
    await assert.rejects(
      env.client.call("flows.publish", { flow: flow.id, expectedDraftVersion: 1, expectedPublishedRevision: null }),
      /publication is unavailable/,
    );
    assert.equal((await env.client.call("flows.graph_get", { flow: flow.id })).publishedRevision, null);
    assert.equal((await env.client.call("flows.retry", { flow: flow.id, event: "one" })).queued, true);
    assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    await env.client.call("flows.set", { ...flow, enabled: true });
    const event = await waitFor(
      () => env.core.store.flows.events(flow.id, 10).find((item) => item.run_id),
      "legacy admission after rejected publication",
    );
    await waitFor(() => env.core.store.runs.get(event.run_id ?? "")?.ended_at, "legacy completion");
    assert.equal(llm.calls.length, 1);
    assert.equal(env.core.store.flows.receive(flow.id, "one", { text: "replacement" }), "duplicate");
    assert.deepEqual(env.core.store.flows.rows(flow.id, 10)[0]?.value, { text: "original" });
    await env.client.call("flows.set", flow);
    const document = await env.client.call("flows.graph_get", { flow: flow.id });
    const socket = await env.client.connect();
    try {
      await assert.rejects(
        socket.call("flows.publish", {
          flow: flow.id,
          expectedDraftVersion: 1,
          expectedPublishedRevision: null,
        }),
        /publication is unavailable/,
      );
      assert.deepEqual(await socket.call("flows.graph_get", { flow: flow.id }), document);
    } finally {
      socket.close();
      await socket.closed;
    }
    assert.equal(document.publishedRevision, null);
    assert.equal(env.core.store.flows.events(flow.id, 10)[0]?.run_id, event.run_id);
    assert.equal(llm.calls.length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
    await folder.remove();
  }
});

test("LLM drafts never certify unknown or unsupported models while graph execution is unavailable", async () => {
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.create", { name: "Project" })).project.id;
    await env.client.call("flows.set", {
      id: "models",
      projectId: project,
      name: "Models",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    for (const model of ["missing/no-such-model", "fake/no-such-model", "claude/opus", "codex", "acp:example/model"]) {
      const draft: FlowGraph = {
        ...graph,
        nodes: [
          { id: "start", kind: "webhook", label: "Webhook" },
          {
            id: "llm",
            kind: "llm",
            label: "Model",
            model,
            prompt: "Summarize",
            input: { kind: "event", path: [] },
            maxOutputTokens: 100,
            timeoutMs: 30000,
          },
        ],
        edges: [{ source: "start", target: "llm" }],
      };
      const result = await env.client.call("flows.validate", { flow: "models", graph: draft });
      assert.equal(result.valid, false, model);
      assert.ok(result.issues.some((issue) => issue.node === "llm" && issue.code === "llm_execution_unavailable"));
      const previous = await env.client.call("flows.graph_get", { flow: "models" });
      const saved = await env.client.call("flows.draft_save", {
        flow: "models",
        expectedVersion: previous.draftVersion,
        graph: draft,
      });
      assert.ok(saved.draftVersion);
      await assert.rejects(
        env.client.call("flows.publish", {
          flow: "models",
          expectedDraftVersion: saved.draftVersion,
          expectedPublishedRevision: null,
        }),
        /publication is unavailable/,
      );
      assert.equal(saved.executionAvailable, false);
    }
    assert.equal((await env.client.call("flows.graph_get", { flow: "models" })).publishedRevision, null);
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
