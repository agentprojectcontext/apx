import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

for (const sharedContext of [false, true])
  test(`distinct learned facts can share owner evidence: correction=${sharedContext}`, async () => {
    const first = sharedContext
      ? "I always prefer CUARZO for internal reports."
      : "I always prefer CSV for internal reports and PDF for clients.";
    const second = sharedContext
      ? "I now always prefer JADE for internal reports. This replaces my earlier CUARZO preference."
      : "Keep both of my report format preferences for future reports.";
    let extracts = 0;
    const env = await startCore({
      aux: true,
      memoryMaintenance: true,
      llm: scriptedLlm((req, { system }) => {
        if (system.startsWith("Validate memory claims")) {
          const { claims } = JSON.parse(String(req.messages.at(-1)?.content));
          return say(
            JSON.stringify({ verdicts: claims.map((_: unknown, index: number) => ({ index, verdict: "supported" })) }),
          );
        }
        if (!system.startsWith("Extract durable")) return say("Understood");
        const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
        extracts++;
        const original = messages.find((m: { text: string }) => m.text === first);
        const next = messages.find((m: { text: string }) => m.text === second);
        const fact = sharedContext
          ? next
            ? "The owner now prefers JADE for internal reports."
            : "The owner always prefers CUARZO for internal reports."
          : "The owner prefers CSV for internal reports.";
        return say(
          JSON.stringify({
            memories: sharedContext
              ? [
                  {
                    kind: "user",
                    fact,
                    evidence: next
                      ? [
                          { message_id: next.id, quote: second },
                          { message_id: original.id, quote: first },
                        ]
                      : [{ message_id: original.id, quote: first }],
                  },
                ]
              : [
                  {
                    kind: "user",
                    fact: next ? "The owner prefers PDF for clients." : fact,
                    message_id: original.id,
                    quote: first,
                  },
                ],
          }),
        );
      }),
    });
    const settle = async () => {
      for (let i = 0; i < 300; i++) {
        if (extracts && env.core.store.memoryWork.recent().every((j) => j.state === "completed")) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail("capture did not settle");
    };
    try {
      await env.client.call("memory.set_settings", { mode: "notes", auto_dream: false, auto_compact: false });
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await env.client.call("threads.send", { thread: thread.id, text: first });
      await env.settle(thread.id);
      await settle();
      assert.equal((await env.client.call("memory.list", {})).memories.length, 1);
      await env.client.call("threads.send", { thread: thread.id, text: second });
      await env.settle(thread.id);
      await settle();
      const notes = (await env.client.call("memory.list", {})).memories;
      assert.equal(notes.length, 2);
      assert.ok(notes.every((n) => n.scope === "agent" && n.evidence?.length && !n.tainted));
      if (sharedContext) assert.ok(notes.some((n) => /JADE/.test(n.text) && n.evidence?.length === 2));
      else assert.ok(notes.some((n) => /PDF/.test(n.text)));
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
