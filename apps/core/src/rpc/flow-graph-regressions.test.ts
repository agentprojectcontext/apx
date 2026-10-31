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

test("publishing leaves legacy pending and failed events on the legacy executor, across a restart", async () => {
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
      action: { kind: "agent" as const, agent: "superagent", prompt: "Summarize original event" },
    };
    await env.client.call("flows.set", flow);
    // Persist at the recovery boundary without waking the dispatcher before disabling.
    env.core.store.flows.save({ ...flow, enabled: true });
    assert.equal(env.core.store.flows.receive(flow.id, "one", { text: "original" }), "pending");
    await env.client.call("flows.set", flow);
    await env.client.call("flows.draft_save", { flow: flow.id, expectedVersion: null, graph });
    const before = env.core.store.flows.admissionInput(flow.id, "one");
    const published = await env.client.call("flows.publish", {
      flow: flow.id,
      expectedDraftVersion: 1,
      expectedPublishedRevision: null,
    });
    assert.equal(published.publishedRevision, 1);
    assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    assert.equal(llm.calls.length, 0);
    await env.core.close();
    env = await startCore({ home: home.path, llm });
    assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    env.core.store.flows.fail(flow.id, "one");
    assert.equal((await env.client.call("flows.retry", { flow: flow.id, event: "one" })).queued, true);
    assert.deepEqual(env.core.store.flows.admissionInput(flow.id, "one"), before);
    // Turning it on runs the legacy event with its own action and snapshot; new events run the drawing.
    await env.client.call("flows.set", { ...flow, enabled: true });
    const event = await waitFor(
      () => env.core.store.flows.events(flow.id, 10).find((item) => item.run_id),
      "legacy admission after publishing",
    );
    await waitFor(() => env.core.store.runs.get(event.run_id ?? "")?.ended_at, "legacy completion");
    assert.equal(llm.calls.length, 1);
    assert.equal(event.executor, "legacy");
    assert.equal(event.current, false);
    const authorize = () => {};
    assert.equal(env.core.store.flows.receive(flow.id, "one", { text: "replacement" }, authorize), "duplicate");
    assert.equal(env.core.store.flows.receive(flow.id, "two", { text: "new" }, authorize), "pending");
    env.core.flows.kick();
    const two = await waitFor(
      () => env.core.store.flows.events(flow.id, 10).find((e) => e.event_id === "two" && e.state === "succeeded"),
      "graph run",
    );
    assert.equal(two.executor, "graph");
    assert.equal(two.revision, 1);
    assert.deepEqual(env.core.store.flows.rows(flow.id, 10)[0]?.value, { text: "new" });
    assert.equal(llm.calls.length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
    await folder.remove();
  }
});

test("a model step names one exact model of a set-up provider; CLI, ACP and unknown references are refused", async () => {
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
    for (const model of [
      "missing/no-such-model",
      "fake",
      "fake/fake-1#high",
      "claude/opus",
      "codex",
      "acp:example/model",
    ]) {
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
      assert.ok(result.issues.some((issue) => issue.node === "llm" && issue.code === "model_unavailable"));
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
        /model is not set up/,
      );
    }
    assert.equal((await env.client.call("flows.graph_get", { flow: "models" })).publishedRevision, null);
    const ok = await env.client.call("flows.validate", {
      flow: "models",
      graph: {
        ...graph,
        nodes: [
          { id: "start", kind: "webhook", label: "Webhook" },
          {
            id: "llm",
            kind: "llm",
            label: "Model",
            model: "fake/fake-1",
            prompt: "Summarize",
            input: { kind: "event", path: [] },
            maxOutputTokens: 100,
            timeoutMs: 30000,
          },
        ],
        edges: [{ source: "start", target: "llm" }],
      },
    });
    assert.deepEqual(ok, { valid: true, issues: [] });
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
