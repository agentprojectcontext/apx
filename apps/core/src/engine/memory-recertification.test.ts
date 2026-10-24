import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseChatMemory } from "../domain/chat-access.ts";
import { memoryClaimKey, memorySourceWindow } from "../domain/memory-evidence.ts";
import { createLog } from "../log.ts";
import type { CallContext } from "../rpc/context.ts";
import { memoryHandlers } from "../rpc/memory.ts";
import { captureNotebook } from "./memory-capture.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const fact = "I now always prefer JADE for internal reports, not CUARZO.";
const index: MemoryIndex = {
  model: () => undefined,
  engine: () => undefined,
  schedule() {},
  stop: async () => {},
  index: async () => ({ indexed: 0, total: 0 }),
  search: async () => [],
  searchEpisodes: async () => [],
};

async function setup() {
  const env = await startCore({ llm: scriptedLlm(() => say("Understood")) });
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: other.id, text: "Ready" });
  await env.settle(other.id);
  const source = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: source.id, text: "Ready" });
  const initial = await env.settle(source.id);
  const answer = initial.messages.find((message) => message.author.kind === "agent");
  assert.ok(answer);
  const fork = await env.client.call("threads.fork", { thread: source.id, message: answer.id });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const sent = await env.client.call("threads.send", { thread: source.id, text: fact });
  await env.settle(source.id);
  const completed = env.core.store.runs.get(sent.run.id);
  assert.ok(completed);
  const evidence = memorySourceWindow(env.core.store, completed)
    .filter((message) => message.text === fact)
    .map((message) => ({ message_id: message.id, quote: message.text }));
  assert.equal(evidence.length, 1);
  const ctx: CallContext = {
    actor: "agent",
    transport: "internal",
    role: "operator",
    session: undefined,
    log: createLog("test", true),
    agent: { id: "roby", thread_id: source.id, run_id: sent.run.id },
    memoryReviewed: [memoryClaimKey(fact, evidence)],
  };
  const params = { scope: "agent" as const, text: fact, kind: "user" as const, evidence, tainted: false };
  return { env, other, source, fork: fork.thread, ctx, params, handler: memoryHandlers(env.core.store, index) };
}

test("recertification updates provenance and cannot cross a prior fork boundary", async () => {
  const { env, other, source, fork, ctx, params, handler } = await setup();
  try {
    const original = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      thread_id: other.id,
      run_id: env.core.store.runs.list(other.id)[0]?.id,
      text: fact,
    });
    const saved = handler["memory.add"]({ ...params, id: original.id, expected_revision: original.revision }, ctx);
    assert.equal(saved.id, original.id);
    assert.equal(saved.thread_id, source.id);
    assert.equal(saved.run_id, ctx.agent?.run_id);
    assert.deepEqual(saved.evidence, params.evidence);
    assert.equal(canUseChatMemory(env.core.store, fork, saved), false);
    assert.equal(canUseChatMemory(env.core.store, source, saved), true);
    assert.equal(canUseChatMemory(env.core.store, other, saved), true);
    assert.ok(env.core.store.memories.history(saved.id).some((version) => version.note.thread_id === other.id));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a reviewed claim cannot certify a target outside its private notebook", async () => {
  const { env, ctx, params, handler } = await setup();
  try {
    for (const target of [
      { scope: "global" as const },
      { scope: "project" as const },
      { scope: "agent" as const, agent_id: "scout" },
      { scope: "agent" as const, agent_id: "roby", source: "owner" as const },
    ]) {
      const note = env.core.store.memories.add({ source: "agent", text: fact, ...target });
      assert.throws(() => handler["memory.add"]({ ...params, id: note.id }, ctx));
      assert.equal(env.core.store.memories.get(note.id)?.revision, 1);
      assert.deepEqual(env.core.store.memories.get(note.id)?.evidence ?? [], []);
    }
    const { project } = await env.client.call("projects.register", { path: env.home, init: true });
    const note = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      project_id: project.id,
      source: "agent",
      text: fact,
    });
    assert.throws(() => handler["memory.add"]({ ...params, id: note.id }, ctx));
    assert.equal(env.core.store.memories.get(note.id)?.revision, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const action of ["edit", "forget"] as const)
  test(`recertification rejects a target changed by ${action} after selection`, async () => {
    const { env, ctx, params, handler } = await setup();
    try {
      const note = env.core.store.memories.add({ scope: "agent", agent_id: "roby", source: "agent", text: fact });
      if (action === "edit")
        env.core.store.memories.edit(note.id, "I always prefer AMBAR for internal reports.", {
          tainted: false,
          pending: false,
        });
      else env.core.store.memories.forget(note.id);
      const changed = env.core.store.memories.get(note.id);
      assert.throws(() => handler["memory.add"]({ ...params, id: note.id, expected_revision: note.revision }, ctx));
      assert.deepEqual(env.core.store.memories.get(note.id), changed);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });

test("other project notes cannot crowd out a repairable personal note", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Understood")) });
  try {
    const personal = env.core.store.memories.add({ scope: "agent", agent_id: "roby", source: "agent", text: fact });
    const { project } = await env.client.call("projects.register", { path: env.home, init: true });
    for (let i = 0; i < 501; i++)
      env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        project_id: project.id,
        source: "agent",
        text: `Unrelated fixture ${i}`,
      });
    const notes = captureNotebook(env.core.store, { agent_id: "roby", project_id: null });
    assert.deepEqual(
      notes.map((note) => note.id),
      [personal.id],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a direct remember edit also updates its origin before any auxiliary capture", async () => {
  const { env, other, source, fork, ctx, handler } = await setup();
  try {
    const note = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      thread_id: other.id,
      text: "I always prefer CUARZO for internal reports.",
    });
    const saved = handler["memory.add"](
      { scope: "agent", id: note.id, text: fact },
      { ...ctx, memoryReviewed: undefined },
    );
    assert.equal(saved.thread_id, source.id);
    assert.equal(saved.run_id, ctx.agent?.run_id);
    assert.deepEqual(saved.evidence, []);
    assert.equal(canUseChatMemory(env.core.store, fork, saved), false);
    assert.equal(canUseChatMemory(env.core.store, source, saved), true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an ineligible worker edit cannot replace a note's fork boundary with its own origin", async () => {
  const { env, source, fork, ctx, handler } = await setup();
  try {
    const note = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      thread_id: source.id,
      run_id: ctx.agent?.run_id,
      text: "I always prefer CUARZO for internal reports.",
    });
    const worker = env.core.store.threads.create({
      kind: "a2a",
      title: "Worker",
      agent_ids: ["roby"],
      parent_id: source.id,
    });
    env.core.store.threads.mergeContext(worker.id, { worker: { name: "Helper", instructions: "Update the report" } });
    const sent = await env.client.call("threads.send", { thread: worker.id, text: "Ready" });
    await env.settle(worker.id);
    const saved = handler["memory.add"](
      { scope: "agent", id: note.id, text: fact },
      {
        ...ctx,
        memoryReviewed: undefined,
        agent: { id: "roby", thread_id: worker.id, run_id: sent.run.id },
      },
    );
    assert.equal(saved.thread_id, source.id);
    assert.equal(saved.run_id, note.run_id);
    assert.equal(canUseChatMemory(env.core.store, fork, saved), false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
