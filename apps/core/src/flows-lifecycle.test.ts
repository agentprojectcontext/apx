import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

const flow = (projectId: string, id: string) => ({
  id,
  projectId,
  name: id,
  enabled: true,
  predicates: [],
  tableKey: "latest",
  action: { kind: "agent" as const, agent: "roby", prompt: "Summarize" },
});

test("a page of busy routine events does not starve a later agent Flow", async () => {
  const folder = tempDir();
  const llm = scriptedLlm(() => say("Ready work"));
  const env = await startCore({ llm });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const routine = await env.client.call("routines.set", {
      name: "Busy",
      agent: "roby",
      project,
      schedule: { kind: "manual" },
      prompt: "Work",
    });
    const thread = env.core.store.threads.create({
      kind: "routine",
      title: "Held routine",
      agent_ids: ["roby"],
      project_id: project,
    });
    const held = env.core.store.runs.create({
      thread_id: thread.id,
      agent_id: "roby",
      trigger: "routine",
      deadline_at: "2099-01-01T00:00:00.000Z",
      input: { origin: { kind: "routine", id: routine.id, name: routine.name }, text: "Held" },
      state: "queued",
    });
    env.core.store.routines.addRun({ routine_id: routine.id, run_id: held.id, thread_id: thread.id });
    env.core.store.flows.save({ ...flow(project, "busy"), action: { kind: "routine", routine: routine.id } });
    for (let i = 0; i < 20; i++) env.core.store.flows.receive("busy", `b${i}`, { work: i });
    env.core.store.flows.save(flow(project, "ready"));
    env.core.store.flows.receive("ready", "ready", { text: "Ready" });
    await env.client.call("flows.set", flow(project, "ready"));
    await waitFor(
      () => env.core.store.flows.events("ready", 10)[0]?.run_state === "completed",
      "ready event after busy page",
    );
    assert.equal(llm.calls.length, 1);
    assert.equal(env.core.store.flows.pending(100).length, 20);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});

test("retirement retries clean up a credential after secret deletion fails", async (t) => {
  const folder = tempDir();
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const definition = { ...flow(project, "cleanup"), enabled: false, action: { kind: "none" as const } };
    await env.client.call("flows.set", { ...definition, enabled: true });
    const credential = await env.client.call("public_routes.rotate", { path: "/flows/cleanup" });
    await env.client.call("flows.set", definition);
    const originalSet = env.core.secrets.set.bind(env.core.secrets);
    const failure = t.mock.method(env.core.secrets, "set", (name: string, value: string | null) => {
      if (value === null) throw new Error("Secret storage unavailable");
      return originalSet(name, value);
    });
    await assert.rejects(env.client.call("flows.retire", { flow: "cleanup", confirm: true }));
    assert.equal(env.core.store.flows.get("cleanup"), undefined);
    assert.ok(env.core.secrets.resolve(credential.secret_ref));
    assert.ok(env.core.store.settings.get("public-route-credentials")?.includes(credential.secret_ref));
    await assert.rejects(env.client.call("flows.set", definition), /Invalid Flow/);
    failure.mock.restore();
    assert.equal((await env.client.call("flows.retire", { flow: "cleanup", confirm: true })).retired, false);
    assert.equal(env.core.secrets.resolve(credential.secret_ref), undefined);
    assert.equal(env.core.store.settings.get("public-route-credentials")?.includes(credential.secret_ref), false);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});

test("retired routes lose credentials, remain unavailable, and cannot inherit another Flow's token", async () => {
  const folder = tempDir();
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    const a = { ...flow(project, "first"), action: { kind: "none" as const } };
    const b = { ...a, id: "second" };
    await env.client.call("flows.set", a);
    await env.client.call("flows.set", b);
    const credential = await env.client.call("public_routes.rotate", { path: "/flows/first" });
    const token = env.core.secrets.resolve(credential.secret_ref);
    const port = (await env.client.call("webhooks.get", {})).port;
    const send = (id: string) =>
      fetch(`http://127.0.0.1:${port}/flows/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: "one", data: { work: true } }),
      });
    assert.equal((await send("second")).status, 401);
    assert.equal(env.core.store.flows.events("second", 10).length, 0);
    await assert.rejects(env.client.call("flows.retire", { flow: "first", confirm: true }), /Disable/);
    await env.client.call("flows.set", { ...a, enabled: false });
    assert.equal((await env.client.call("flows.retire", { flow: "first", confirm: true })).retired, true);
    assert.equal(env.core.secrets.resolve(credential.secret_ref), undefined);
    assert.equal((await send("first")).status, 404);
    await assert.rejects(env.client.call("flows.set", a), /Invalid Flow/);
    assert.equal((await send("second")).status, 401);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
