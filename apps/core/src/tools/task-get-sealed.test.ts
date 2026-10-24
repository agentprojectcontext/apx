import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("task_get never exposes sealed client conversations to the global secretary", async () => {
  const llm = scriptedLlm((req, { said, afterTool }) =>
    afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("get", "task_get", { task: said }),
  );
  const env = await startCore({ llm });
  try {
    const { store } = env.core;
    const task = await env.client.call("tasks.create", { title: "Shared task" });
    const session = store.threads.create({
      kind: "loose",
      title: "Sealed session",
      agent_ids: ["roby"],
      task_id: task.id,
    });
    const consult = store.threads.create({
      kind: "a2a",
      title: "Sealed consult",
      agent_ids: ["roby"],
      parent_id: task.thread_id,
    });
    store.threads.mergeContext(consult.id, { consult: { task: task.id, card: "msg_card" } });
    for (const id of [task.thread_id, session.id, consult.id]) {
      store.threads.mergeContext(id, { client: "client_private" });
      store.messages.add({
        thread_id: id,
        author: { kind: "user" },
        parts: [{ type: "text", text: "Private customer evidence" }],
      });
    }
    const owner = await env.client.call("tasks.get", { task: task.id });
    assert.equal(owner.comments.length, 1);
    assert.equal(owner.sessions.length, 1);
    assert.equal(owner.consults.length, 1);
    const model = new ApxClient({ url: env.core.url, actor: "agent" });
    const socket = await model.connect();
    try {
      for (const caller of [model, socket]) {
        const details = await caller.call("tasks.get", { task: task.id });
        assert.equal(details.comments.length, 0);
        assert.equal(details.sessions.length, 0);
        assert.equal(details.consults.length, 0);
        assert.doesNotMatch(JSON.stringify(details), /Private customer evidence|Sealed session|Sealed consult/);
      }
    } finally {
      socket.close();
      await socket.closed;
    }
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: task.id });
    await env.settle(thread.id);
    const result = String(llm.calls.at(-1)?.messages.at(-1)?.content);
    assert.match(result, /Shared task/);
    assert.match(result, /Comments \(latest 0\)/);
    assert.match(result, /Sessions:\n\[\]/);
    assert.match(result, /Consults:\n\[\]/);
    assert.doesNotMatch(result, /Sealed session|Sealed consult|Private customer evidence|client_private/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
