import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("dream reads the correction's evidence and retries unknown identifiers before checkpointing", async () => {
  let attempts = 0;
  const correction = "I now always prefer JADE for internal reports. This replaces my earlier CUARZO preference.";
  const env = await startCore({
    aux: true,
    memoryMaintenance: true,
    llm: scriptedLlm((req, { system }) => {
      if (system.startsWith("Extract durable")) return say('{"memories":[]}');
      if (system.startsWith("Validate memory retirements"))
        return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
      if (!system.startsWith("Review private memory")) return say("Understood");
      const { notes } = JSON.parse(String(req.messages.at(-1)?.content));
      const old = notes.find(
        (n: { text: string }) => n.text === "The owner always prefers CUARZO for internal reports.",
      );
      const paraphrase = notes.find((n: { text: string }) => n.text.startsWith("An earlier"));
      const replacement = notes.find((n: { text: string }) => n.text.includes("JADE"));
      assert.equal(replacement.evidence[0].quote, correction);
      attempts++;
      return say(
        JSON.stringify({
          groups: [[old.id, paraphrase.id]],
          retire: [{ id: attempts === 1 ? "misspelled-note-id" : old.id, by: replacement.id }],
        }),
      );
    }),
  });
  try {
    await env.client.call("memory.set_settings", { mode: "notes", auto_dream: false, auto_compact: false });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Review the notebook." });
    await env.settle(thread.id);
    // A correction supersedes only notes written before it, so each note lands on a later millisecond.
    const add = async (text: string, quote: string) => {
      const at = Date.now();
      while (Date.now() === at) await new Promise((r) => setTimeout(r, 1));
      const message = env.core.store.messages.add({
        thread_id: thread.id,
        author: { kind: "user" },
        parts: [{ type: "text", text: quote }],
      });
      return env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        source: "agent",
        thread_id: thread.id,
        text,
        tainted: false,
        evidence: [{ message_id: message.id, quote }],
      });
    };
    const old = await add(
      "The owner always prefers CUARZO for internal reports.",
      "I always prefer CUARZO for internal reports.",
    );
    const paraphrase = await add(
      "An earlier preference used CUARZO for internal reports.",
      "I always prefer CUARZO for internal reports.",
    );
    const replacement = await add("The owner now prefers JADE for internal reports.", correction);
    const legacyFingerprint = [old, paraphrase, replacement]
      .map((n) => `${n.id}:${n.revision}`)
      .sort()
      .join(",");
    env.core.store.settings.set("memory_dream_snapshot:roby:", legacyFingerprint);
    await env.client.call("memory.set_settings", { mode: "notes", auto_dream: true, auto_compact: false });
    await env.client.call("memory.maintenance", { dream: true });
    await waitFor(() => env.core.store.memoryWork.recent().some((j) => j.kind === "dream" && !!j.error));
    const job = env.core.store.memoryWork.recent().find((j) => j.kind === "dream");
    assert.ok(job);
    assert.deepEqual(JSON.parse(job.result ?? "{}"), {});
    assert.equal(env.core.store.memories.get(old.id)?.forgotten_at, undefined);
    // A previous install may already have persisted an invalid model proposal.
    env.core.store.memoryWork.checkpoint(job.id, {
      extracted: JSON.stringify({ groups: [["missing", old.id]], retire: [] }),
    });
    env.core.store.memoryWork.defer(job.id, "legacy retry", new Date(0).toISOString());
    await env.client.call("memory.maintenance", {});
    await waitFor(() =>
      env.core.store.memoryWork
        .recent()
        .some(
          (j) =>
            j.id === job.id &&
            j.error === "memory maintenance failed" &&
            JSON.parse(j.result ?? "{}").extracted === undefined,
        ),
    );
    assert.equal(attempts, 1);
    env.core.store.memoryWork.defer(job.id, "retry", new Date(0).toISOString());
    await env.client.call("memory.maintenance", {});
    await waitFor(() => env.core.store.memoryWork.get(job.id)?.state === "completed");
    assert.equal(JSON.parse(env.core.store.memoryWork.get(job.id)?.result ?? "{}").retired, 1);
    assert.ok(env.core.store.memories.get(old.id)?.forgotten_at);
    assert.equal(attempts, 2);
    assert.equal(env.core.store.memories.get(paraphrase.id)?.forgotten_at, undefined);
    assert.equal(env.core.store.memories.get(replacement.id)?.forgotten_at, undefined);
    assert.equal(env.core.store.memories.history(old.id)[0]?.reason, `superseded:${replacement.id}`);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
