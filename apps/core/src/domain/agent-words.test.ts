import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { postAgentWords } from "./agent-words.ts";

test("an agent's words outside a turn show in the chat, open its history after a note, and count as news only if asked", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { store } = env.core;
    const chat = store.threads.create({ kind: "loose", title: "Notes", agent_ids: ["roby"] });
    postAgentWords(store, {
      thread_id: chat.id,
      agent_id: "roby",
      text: "Hello",
      note: "[APX: a note]",
      unread: false,
    });
    postAgentWords(store, {
      thread_id: chat.id,
      agent_id: "roby",
      text: "News",
      said: "News\n\n1. Act",
      note: "[APX: news]",
      unread: true,
    });
    const messages = store.messages.list(chat.id);
    assert.deepEqual(
      messages.map((m) => [m.author, m.parts]),
      [
        [{ kind: "agent", id: "roby" }, [{ type: "text", text: "Hello" }]],
        [{ kind: "agent", id: "roby" }, [{ type: "text", text: "News" }]],
      ],
    );
    assert.deepEqual(
      store.modelLog.list(chat.id).map((e) => {
        const item = e.item as { role: string; content: string };
        return [item.role, item.content];
      }),
      [
        ["user", "[APX: a note]"],
        ["assistant", "Hello"],
        ["user", "[APX: news]"],
        ["assistant", "News\n\n1. Act"],
      ],
    );
    const after = store.threads.get(chat.id);
    assert.equal(after?.preview, "News");
    assert.equal(after?.unread, 1, "only the words marked as news count");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
