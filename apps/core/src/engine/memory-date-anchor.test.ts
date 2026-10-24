import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";
import { turnInput } from "./context.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const mixedDays of [false, true])
  test(`relative memory dates use an unambiguous owner-local source day: mixed=${mixedDays}`, async () => {
    let id = "";
    const tool = defineTool({
      name: "normalize_dates",
      description: "Normalize relative dates",
      args: z.object({}),
      effect: "local",
      deadlineMs: 1000,
      title: () => "Normalize dates",
      async run(_, ctx) {
        return JSON.stringify(await ctx.call("memory.tidy", { redate: [{ id, revision: 1 }] }));
      },
    });
    const env = await startCore({
      llm: scriptedLlm((_, { afterTool }) => (afterTool ? say("Done") : callTool("tidy", tool.name, {}))),
      extraTools: [tool],
    });
    try {
      const zone = "Pacific/Kiritimati";
      const at = "2026-01-01T10:30:00.000Z";
      await env.client.call("owner.set", { timezone: zone });
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      const quotes = mixedDays
        ? [
            { text: "Acme siempre usa revisión corta.", at: "2026-01-01T09:30:00.000Z" },
            { text: "La fecha de inicio es mañana.", at },
          ]
        : [{ text: "Acme siempre usa revisión corta. La fecha de inicio es mañana.", at }];
      const evidence = quotes.map(({ text, at }) => ({
        message_id: env.core.store.messages.add({
          thread_id: thread.id,
          author: { kind: "user" },
          parts: [{ type: "text", text }],
          at,
        }).id,
        quote: text,
      }));
      id = env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        source: "agent",
        author_agent: "roby",
        text: "Acme siempre usa revisión corta. La fecha de inicio es mañana.",
        evidence,
        tainted: false,
      }).id;
      assert.match(
        turnInput({ origin: { kind: "user" }, text: "Review", now: new Date(at), timeZone: zone }),
        /January 2, 2026/,
      );
      await env.client.call("threads.send", { thread: thread.id, text: "Normalize dates" });
      await env.settle(thread.id);
      const note = env.core.store.memories.get(id);
      if (mixedDays) {
        assert.match(note?.text ?? "", /mañana/);
        assert.equal(note?.revision, 1);
      } else {
        assert.match(note?.text ?? "", /2026-01-03/);
        assert.equal(note?.revision, 2);
      }
      assert.equal(env.core.store.runs.list(thread.id)[0]?.state, "completed");
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
