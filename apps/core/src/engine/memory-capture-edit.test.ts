import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const first = "I always prefer CUARZO for internal reports.";
const correction = "I now always prefer JADE for internal reports, not CUARZO.";

for (const scenario of ["manual-edit", "global-pending", "global-deleted", "owner-note"] as const)
  test(`capture preserves source evidence around an existing note: ${scenario}`, async () => {
    let noteId = "";
    let reviews = 0;
    const env = await startCore({
      aux: true,
      memoryMaintenance: true,
      llm: scriptedLlm((request, { system, said, afterTool }) => {
        if (system.startsWith("Extract durable")) {
          const { messages, existing } = JSON.parse(String(request.messages.at(-1)?.content));
          const source =
            messages.find((message: { text: string }) => message.text === correction) ??
            messages.find((message: { text: string }) => message.text === first);
          return say(
            JSON.stringify({
              memories:
                source && !existing.includes(source.text)
                  ? [{ kind: "user", message_id: source.id, quote: source.text, fact: source.text }]
                  : [],
            }),
          );
        }
        if (system.startsWith("Validate memory claims")) {
          reviews++;
          return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
        }
        if (afterTool) return say(String(request.messages.at(-1)?.content));
        if (said === "Probe current notes") return callTool("recall", "recall", { query: "CUARZO internal reports" });
        if (scenario.startsWith("global-") && said === first)
          return callTool("remember-global", "remember", {
            text: "Reports inside the company: CUARZO is the preferred label.",
            scope: "global",
          });
        if (scenario === "manual-edit" && said === correction)
          return callTool("edit-private", "remember", { text: correction, scope: "agent", id: noteId });
        return say("Understood");
      }),
    });
    async function settledMemory() {
      for (let attempt = 0; attempt < 300; attempt++) {
        const jobs = env.core.store.memoryWork.recent();
        if (jobs.length && jobs.every((job) => job.state === "completed")) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail("memory capture did not settle");
    }
    try {
      await env.client.call("memory.set_settings", { mode: "notes", auto_compact: false, auto_dream: false });
      if (scenario === "owner-note")
        noteId = (await env.client.call("memory.add", { scope: "agent", agent: "roby", text: first })).id;
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await env.client.call("threads.send", { thread: thread.id, text: first });
      await env.settle(thread.id);
      await settledMemory();
      const original = (await env.client.call("memory.list", {})).memories;
      if (scenario === "owner-note") {
        assert.equal(original.length, 1);
        assert.equal(original[0]?.id, noteId);
        assert.equal(original[0]?.source, "owner");
        assert.equal(original[0]?.revision, 1);
        assert.equal(reviews, 0);
      } else if (scenario === "manual-edit") {
        assert.equal(original.length, 1);
        noteId = original[0]?.id ?? "";
        assert.ok(original[0]?.evidence?.some((entry) => entry.quote === first));
        await env.client.call("threads.send", { thread: thread.id, text: correction });
        await env.settle(thread.id);
        await settledMemory();
        const notes = (await env.client.call("memory.list", {})).memories;
        assert.equal(notes.length, 1, "recertification must not create a duplicate note");
        assert.equal(notes[0]?.id, noteId);
        assert.equal(notes[0]?.text, correction);
        assert.ok(notes[0]?.evidence?.some((entry) => entry.quote === correction));
        const { versions } = await env.client.call("memory.history", { id: noteId });
        assert.ok(
          versions.some(
            (version) => version.note.text === first && version.note.evidence?.some((entry) => entry.quote === first),
          ),
        );
        assert.ok(versions.some((version) => version.note.text === correction && version.note.evidence?.length === 0));
        assert.equal(reviews, 2);
      } else {
        const pending = original.find((note) => note.scope === "global");
        const privateNote = original.find((note) => note.scope === "agent");
        assert.ok(pending?.pending);
        assert.ok(privateNote?.evidence?.some((entry) => entry.quote === first));
        assert.equal(privateNote?.pending, false);
        assert.equal(reviews, 1);
        await env.client.call("memory.remove", { id: pending.id, forever: scenario === "global-deleted" });
        await env.client.call("memory.maintenance", { backfill: true });
        await settledMemory();
        const fresh = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
        await env.client.call("threads.send", { thread: fresh.id, text: "Probe current notes" });
        const result = await env.settle(fresh.id);
        assert.doesNotMatch(texts(result.messages).join("\n"), /CUARZO/);
      }
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
