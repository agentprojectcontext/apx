import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createFlows } from "./flows.ts";
import { createLog } from "./log.ts";
import { tempDir } from "./testkit/platform.ts";

test("run admission rolls back when its event linkage cannot commit, for both agent and routine", async () => {
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const ctx = {
      transport: "internal" as const,
      role: "operator" as const,
      actor: "agent" as const,
      session: undefined,
      log: createLog("test", true),
      flowEvent: { flow: "missing", event: "missing" },
    };
    const sent = await env.core.dispatch(
      "threads.send",
      { thread: thread.id, text: "Untrusted event" },
      ctx,
      "atomic-agent",
    );
    assert.equal(sent.ok, false);
    const after = await env.client.call("threads.get", { thread: thread.id });
    assert.equal(after.messages.length, 0);
    assert.equal(after.runs.length, 0);
    const routine = await env.client.call("routines.set", {
      name: "Atomic",
      agent: "roby",
      schedule: { kind: "manual" },
      prompt: "Work",
    });
    const started = await env.core.dispatch(
      "routines.run",
      { routine: routine.id },
      { ...ctx, actor: "human" },
      "atomic-routine",
    );
    assert.equal(started.ok, false);
    assert.equal(env.core.store.routines.runs(routine.id, 10).length, 0);
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a canceled public request cannot persist an event; unexpected top-level fields cannot select an action", async () => {
  const folder = tempDir();
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm });
  const flows = createFlows({ store: env.core.store, dispatch: () => undefined, log: createLog("test", true) });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    await env.client.call("flows.set", {
      id: "safe",
      projectId: project,
      name: "Safe",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const route = flows.routes("/flows/safe");
    assert.ok(route);
    const aborted = new AbortController();
    aborted.abort();
    const request = {
      method: "POST",
      path: "/flows/safe",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ id: "cancel", data: { text: "Work" } })),
    };
    assert.equal((await route.handle(request, aborted.signal)).status, 503);
    const hostile = { ...request, body: Buffer.from(JSON.stringify({ id: "bad", data: {}, agent: "roby" })) };
    assert.equal((await route.handle(hostile, new AbortController().signal)).status, 400);
    assert.equal(
      (await route.handle({ ...request, body: Buffer.alloc(65537) }, new AbortController().signal)).status,
      413,
    );
    assert.equal(env.core.store.flows.events("safe", 10).length, 0);
    assert.equal(llm.calls.length, 0);
  } finally {
    await flows.close();
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
