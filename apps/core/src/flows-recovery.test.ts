import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

// A committed event not yet dispatched is the same recovery boundary as a process dying after its webhook ACK.
test("pending work recovers after restart and never readmits a linked run", async () => {
  const home = tempDir();
  const folder = tempDir();
  const llm = scriptedLlm(() => say("Recovered"));
  let env = await startCore({ home: home.path, llm });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const flow = {
      id: "recovery",
      projectId: project,
      name: "Recovery",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "agent" as const, agent: "roby", prompt: "Summarize event" },
    };
    await env.client.call("flows.set", flow);
    // Disabled events stay pending without being polled or turning into model calls.
    await env.client.call("flows.set", { ...flow, enabled: false });
    env.core.store.flows.save(flow);
    assert.equal(env.core.store.flows.receive(flow.id, "pending", { message: "Hello" }), "pending");
    assert.equal(llm.calls.length, 0);
    await env.core.close();
    env = await startCore({ home: home.path, llm });
    const admitted = await waitFor(
      () => env.core.store.flows.events(flow.id, 10).find((e) => e.run_id),
      "recovered Flow admission",
    );
    await waitFor(() => env.core.store.runs.get(admitted.run_id ?? "")?.ended_at, "recovered run completion");
    assert.equal(llm.calls.length, 1);
    assert.equal(env.core.store.flows.receive(flow.id, "pending", { message: "Changed" }), "duplicate");
    await env.core.close();
    env = await startCore({ home: home.path, llm });
    assert.equal(env.core.store.flows.events(flow.id, 10)[0]?.run_id, admitted.run_id);
    assert.equal(env.core.store.flows.pending().length, 0);
    assert.equal(llm.calls.length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
    await folder.remove();
  }
});

test("a failed admission retries only after owner action and cannot retry an admitted event", async () => {
  const folder = tempDir();
  const llm = scriptedLlm(() => say("Retried"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const flow = {
      id: "retry",
      projectId: project,
      name: "Retry",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "agent" as const, agent: "missing", prompt: "Summarize event" },
    };
    // Simulate a binding that was valid when the event arrived and was removed before dispatch.
    env.core.store.flows.save(flow);
    env.core.store.flows.receive(flow.id, "one", { text: "Work" });
    await env.client.call("flows.retry", { flow: flow.id, event: "one" });
    await waitFor(() => env.core.store.flows.events(flow.id, 10)[0]?.state === "failed", "failed admission");
    assert.equal(llm.calls.length, 0);
    assert.match(env.core.store.flows.events(flow.id, 10)[0]?.error ?? "", /could not be admitted/);
    // Saved events retain their original fixed binding even if the Flow is edited.
    await env.client.call("flows.set", { ...flow, action: { ...flow.action, agent: "roby" } });
    assert.equal((await env.client.call("flows.retry", { flow: flow.id, event: "one" })).queued, true);
    await waitFor(() => env.core.store.flows.events(flow.id, 10)[0]?.state === "failed", "unchanged event binding");
    assert.equal(llm.calls.length, 0);
    assert.equal((await env.client.call("flows.retry", { flow: flow.id, event: "missing" })).queued, false);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
