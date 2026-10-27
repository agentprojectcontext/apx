import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const failure of ["empty", "failed"] as const) {
  test(`task consult persists ${failure} outcome in the response and its original card`, async () => {
    let task = "";
    const env = await startCore({
      llm: scriptedLlm((_req, { system, said, afterTool }) => {
        if (system.startsWith("You are Helper")) {
          if (failure === "failed") throw new Error("Consult unavailable");
          return say("");
        }
        if (!afterTool && said === "Ask helper")
          return callTool("ask", "task_comment", { task, text: "@helper check this" });
        return say("Received the outcome.");
      }),
    });
    try {
      await env.client.call("agents.create", { slug: "helper", name: "Helper" });
      const created = await env.client.call("tasks.create", { title: "Check the change" });
      task = created.id;
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await env.client.call("threads.send", { thread: chat.id, text: "Ask helper" });
      await env.settle(chat.id);
      const child = env.core.store.threads.children(created.thread_id)[0];
      assert.ok(child);
      await env.settle(child);
      await env.settle(chat.id);
      const loaded = await env.client.call("threads.get", { thread: chat.id });
      const response = loaded.messages.flatMap((m) =>
        m.parts.flatMap((p) => (p.type === "text" && p.response ? [p.response] : [])),
      )[0];
      assert.ok(response);
      assert.equal(response.thread_id, child);
      const made = await env.client.call("clients.create", { name: "Scoped reader", scopes: ["chat"] });
      const scoped = new ApxClient({ url: env.core.url, clientToken: made.token });
      await assert.rejects(scoped.call("threads.get", { thread: response.thread_id }), /only use the chats it started/);
      const socket = await new ApxClient({ url: env.core.url, token: made.token }).connect();
      try {
        await assert.rejects(
          socket.call("threads.get", { thread: response.thread_id }),
          /only use the chats it started/,
        );
      } finally {
        socket.close();
      }
      const card = env.core.store.messages
        .list(created.thread_id, 50)
        .flatMap((m) => m.parts)
        .find((p) => p.type === "subthread");
      assert.equal(card?.type, "subthread");
      if (card?.type !== "subthread") throw new Error("Missing consult card");
      if (failure === "empty") {
        assert.equal(response.issue, "no_answer");
        assert.equal(card.issue, "no_answer");
      } else {
        assert.equal(response.state, "failed");
        assert.equal(card.state, "failed");
        assert.equal(response.end_reason, "failed");
      }
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
