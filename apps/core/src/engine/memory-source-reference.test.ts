import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const preference = "I always prefer CSV for internal reports.";

test("capture retries unknown source IDs before checkpointing and discards invalid legacy references", async () => {
  let extracts = 0;
  let reviews = 0;
  const invalid = JSON.stringify({
    memories: [{ kind: "user", message_id: "unknown-owner-message", quote: preference, fact: preference }],
  });
  const env = await startCore({
    aux: true,
    memoryMaintenance: true,
    llm: scriptedLlm((request, { system }) => {
      if (system.startsWith("Extract durable")) {
        extracts++;
        if (extracts === 1) return say(invalid);
        const { messages } = JSON.parse(String(request.messages.at(-1)?.content));
        return say(
          JSON.stringify({
            memories: [{ kind: "user", message_id: messages[0].id, quote: preference, fact: preference }],
          }),
        );
      }
      if (system.startsWith("Validate memory")) {
        reviews++;
        return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
      }
      return say("Understood");
    }),
  });
  try {
    await env.client.call("memory.set_settings", { mode: "notes", auto_compact: false, auto_dream: false });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const sent = await env.client.call("threads.send", { thread: thread.id, text: preference });
    await env.settle(thread.id);
    await waitFor(() =>
      env.core.store.memoryWork
        .recent()
        .some((job) => job.kind === "capture" && (job.error || job.state === "completed")),
    );
    const job = env.core.store.memoryWork.recent().find((job) => job.kind === "capture");
    assert.ok(job);
    assert.equal(job.state, "pending");
    assert.equal(job.error, "memory maintenance failed");
    assert.equal(job.attempts, 1);
    assert.deepEqual(JSON.parse(job.result ?? "{}"), {});
    assert.equal(reviews, 0);
    assert.equal(env.core.store.memories.list({ agent_id: "roby", limit: 10 }).length, 0);
    env.core.store.memoryWork.defer(job.id, "retry", new Date(0).toISOString());
    await env.client.call("memory.maintenance", {});
    await waitFor(() => env.core.store.memoryWork.get(job.id)?.state === "completed");
    const notes = env.core.store.memories.list({ agent_id: "roby", limit: 10 });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.text, preference);
    assert.equal(notes[0]?.evidence?.[0]?.message_id, sent.message.id);
    assert.equal(extracts, 2);
    assert.equal(reviews, 1);
    assert.equal(env.core.store.memoryWork.get(job.id)?.reservation, 3);

    const legacyId = `legacy:${sent.run.id}`;
    env.core.store.memoryWork.enqueue({
      id: legacyId,
      kind: "capture",
      agent_id: "roby",
      thread_id: thread.id,
      run_id: sent.run.id,
    });
    env.core.store.memoryWork.checkpoint(legacyId, { extracted: invalid, reviewed: ["stale-certificate"] });
    await env.client.call("memory.maintenance", {});
    await waitFor(() => !!env.core.store.memoryWork.get(legacyId)?.error);
    assert.deepEqual(JSON.parse(env.core.store.memoryWork.get(legacyId)?.result ?? "{}"), {});
    env.core.store.memoryWork.defer(legacyId, "retry", new Date(0).toISOString());
    await env.client.call("memory.maintenance", {});
    await waitFor(() => env.core.store.memoryWork.get(legacyId)?.state === "completed");
    assert.equal(extracts, 3);
    assert.equal(reviews, 1);
    assert.equal(env.core.store.memoryWork.get(legacyId)?.reservation, 1);
    assert.deepEqual(env.core.store.memories.list({ agent_id: "roby", limit: 10 }), notes);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
