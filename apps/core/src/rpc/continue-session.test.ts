import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import { createLog } from "../log.ts";

async function fixture() {
  const env = await startCore({ llm: scriptedLlm((_req, { said }) => say(`Finished: ${said}`)) });
  const { store } = env.core;
  const root = store.threads.create({ kind: "loose", title: "Review", agent_ids: ["roby"] });
  const parent = store.runs.create({
    thread_id: root.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Review" },
    deadline_at: new Date().toISOString(),
  });
  store.runs.setState(parent, "completed", undefined, { reason: "normal" });
  const sub = store.threads.create({
    kind: "a2a",
    title: "Check sources",
    agent_ids: ["roby"],
    parent_id: root.id,
    session: "research",
    write: "read-only",
    cwd: env.home,
  });
  const stopped = store.runs.create({
    thread_id: sub.id,
    agent_id: "roby",
    trigger: "a2a",
    parent_run_id: parent.id,
    depth: 1,
    input: {
      origin: { kind: "agent", id: "roby", name: "Roby", thread_id: root.id, run_id: parent.id },
      text: "Check sources",
    },
    deadline_at: new Date().toISOString(),
  });
  store.runs.setState(stopped, "completed", undefined, { reason: "step_limit" });
  return { env, root, sub, parent, stopped };
}

test("the owner continues a stopped session once, retaining its workspace, cap and result destination", async () => {
  const { env, root, sub, parent, stopped } = await fixture();
  const socket = await env.client.connect();
  try {
    const sent = await socket.call("threads.send", {
      thread: sub.id,
      text: "Check the rest",
      continue_run: stopped.id,
    });
    assert.equal(sent.run.parent_run_id, parent.id);
    assert.equal(sent.run.trigger, "a2a");
    assert.equal(sent.run.depth, 1);
    assert.equal(env.core.store.runs.get(sent.run.id)?.input?.continues, stopped.id);
    const reply = await env.settle(sub.id);
    assert.match(texts(reply.messages).join("\n"), /Finished: Check the rest/);
    assert.equal(env.core.store.threads.get(sub.id)?.cwd, sub.cwd);
    assert.equal(env.core.store.threads.get(sub.id)?.write, "read-only");
    await env.settle(root.id);
    const delivery = env.core.store.runs.list(root.id).find((r) => r.input?.origin.kind === "delegation_result");
    assert.equal(delivery?.input?.origin.kind === "delegation_result" && delivery.input.origin.run_id, sent.run.id);
    await assert.rejects(
      env.client.call("threads.send", { thread: sub.id, text: "Duplicate", continue_run: stopped.id }),
      /changed|no longer stopped/,
    );
    assert.equal(env.core.store.runs.list(sub.id).length, 2);
  } finally {
    socket.close();
    await env.core.close();
    await env.cleanup();
  }
});

test("stale, busy, completed, archived and unrelated sessions cannot be continued", async () => {
  const { env, root, sub, stopped } = await fixture();
  try {
    const send = () => env.client.call("threads.send", { thread: sub.id, text: "Continue", continue_run: stopped.id });
    for (const state of ["working", "submitted", "queued", "input-required"] as const) {
      env.core.store.threads.patch(sub.id, { state });
      await assert.rejects(send(), /changed|no longer stopped/);
    }
    env.core.store.threads.patch(sub.id, { state: "idle" });
    env.core.store.threads.arrange(sub.id, { archived: true });
    await assert.rejects(send(), /delegated session/);
    env.core.store.threads.arrange(sub.id, { archived: false });
    env.core.store.runs.setState(stopped, "completed", undefined, { reason: "normal" });
    await assert.rejects(send(), /changed|no longer stopped/);
    await assert.rejects(
      env.client.call("threads.send", { thread: root.id, text: "Wrong session", continue_run: stopped.id }),
      /delegated session/,
    );
    assert.equal(env.core.store.runs.list(sub.id).length, 1);
    assert.equal(env.core.store.messages.list(sub.id).length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const budget of ["none", "chain", "agent"] as const)
  test(`continuation waits for a slot and starts even with the ${budget} budget spent`, async () => {
    const { env, root, sub, stopped, parent } = await fixture();
    try {
      const { store } = env.core;
      const busy = Array.from({ length: 3 }, (_, i) => {
        const t = store.threads.create({ kind: "a2a", title: `Part ${i}`, agent_ids: ["roby"], parent_id: root.id });
        const r = store.runs.create({
          thread_id: t.id,
          agent_id: "roby",
          trigger: "a2a",
          parent_run_id: parent.id,
          input: { origin: { kind: "user" }, text: "Working" },
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
        });
        store.threads.patch(t.id, { state: "submitted" });
        return { t, r };
      });
      if (budget === "chain") await env.client.call("agents.set_limits", { runs: 1, tokens: 0 });
      if (budget === "agent") await env.client.call("agents.set_agent_limits", { agent: "roby", limits: { runs: 1 } });
      const held =
        budget !== "none"
          ? store.runs.create({
              thread_id: store.threads.create({ kind: "a2a", title: "Held", agent_ids: ["roby"], parent_id: root.id })
                .id,
              agent_id: "roby",
              trigger: "a2a",
              parent_run_id: parent.id,
              state: "queued",
              input: {
                origin: { kind: "agent", id: "roby", name: "Roby", thread_id: root.id, run_id: parent.id },
                text: "Wait",
              },
              deadline_at: new Date(Date.now() + 60_000).toISOString(),
            })
          : undefined;
      const sent = await env.client.call("threads.send", {
        thread: sub.id,
        text: "Check the rest",
        continue_run: stopped.id,
      });
      assert.equal(sent.run.state, "queued");
      assert.equal(store.threads.get(sub.id)?.state, "queued");
      assert.equal(store.runs.activeDelegations(root.id), 3);
      const first = busy[0];
      assert.ok(first);
      await env.client.call("threads.cancel", { thread: first.t.id });
      const result = await env.settle(sub.id);
      assert.equal(result.runs.find((r) => r.id === sent.run.id)?.state, "completed");
      assert.match(texts(result.messages).join("\n"), /Finished: Check the rest/);
      assert.equal(store.runs.list(sub.id).length, 2);
      if (held) assert.equal(store.runs.get(held.id)?.state, "queued", "the click authorizes only its own turn");
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });

test("models and external clients cannot continue sessions; concurrent owner clicks start only one turn", async () => {
  const { env, sub, stopped } = await fixture();
  try {
    const params = { thread: sub.id, text: "Check the rest", continue_run: stopped.id };
    const model = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(model.call("threads.send", params), /only the owner/);
    const made = await env.client.call("clients.create", { name: "Test client", scopes: ["chat"] });
    const outside = new ApxClient({ url: env.core.url, clientToken: made.token });
    await assert.rejects(outside.call("threads.send", params), /only use the chats it started|only the owner/);
    const channel = await env.core.dispatch(
      "threads.send",
      params,
      {
        role: "operator",
        actor: "human",
        transport: "internal",
        session: undefined,
        log: createLog("test", true),
        channel: { id: "channel_test", conversation: "contact", person_id: "owner", name: "Owner", role: "owner" },
      },
      "channel-continue",
    );
    assert.equal(channel.ok, false);
    assert.match(!channel.ok ? channel.error.message : "", /only the owner/);
    assert.equal(env.core.store.runs.list(sub.id).length, 1);
    const clicked = await Promise.allSettled([
      env.client.call("threads.send", params),
      env.client.call("threads.send", params),
    ]);
    assert.equal(clicked.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(clicked.filter((r) => r.status === "rejected").length, 1);
    await env.settle(sub.id);
    assert.equal(env.core.store.runs.list(sub.id).length, 2);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
