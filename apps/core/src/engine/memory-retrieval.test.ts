import assert from "node:assert/strict";
import { test } from "node:test";
import { recallChats } from "./chat-recall.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const survey = "Northwind feedback form asks about onboarding and notifications.";
const question = "How was setup? Which alerts matter?";
const indexWith = (rows: Awaited<ReturnType<MemoryIndex["searchEpisodes"]>>): MemoryIndex => ({
  model: () => undefined,
  engine: () => undefined,
  schedule() {},
  stop: async () => {},
  index: async () => ({ indexed: 0, total: 0 }),
  search: async () => [],
  searchEpisodes: async () => rows,
});

async function source(env: Awaited<ReturnType<typeof startCore>>, text: string, thread?: string) {
  const t = thread
    ? env.core.store.threads.get(thread)
    : await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  assert.ok(t);
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id);
  const run = env.core.store.runs.list(t.id, 1)[0];
  assert.ok(run);
  const message = env.core.store.memorySources.forRun(run.id)[0];
  assert.ok(message);
  return {
    thread: t,
    run,
    episode: {
      run_id: run.id,
      thread_id: t.id,
      agent_id: "roby",
      project_id: null,
      message_id: message,
      text,
      created_at: run.started_at,
    },
  };
}

test("old history in the current chat is recalled by meaning without visible turns or assistant claims", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say(question)) });
  try {
    const old = await source(env, survey);
    const recent = await source(env, "The current topic is lunch arrangements.", old.thread.id);
    const snapshot = await recallChats(
      env.core.store,
      indexWith([old.episode, recent.episode]),
      "roby",
      old.thread,
      "Can participants tap choices in that questionnaire?",
      { excludeRuns: new Set([recent.run.id]) },
    );
    const text = snapshot?.render() ?? "";
    assert.match(text, /Northwind feedback/);
    assert.doesNotMatch(text, /Which alerts matter/, "assistant claims require an explicit chat read");
    assert.doesNotMatch(text, /lunch arrangements/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an older semantic match keeps its rank ahead of more than four recent distractors", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const old = await source(env, survey);
    const distractors = [];
    for (let n = 0; n < 6; n++)
      distractors.push((await source(env, `Questionnaire migration maintenance ticket ${n}.`)).episode);
    const target = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const snapshot = await recallChats(
      env.core.store,
      indexWith([old.episode, ...distractors]),
      "roby",
      target,
      "Questionnaire choices?",
    );
    assert.match(snapshot?.render() ?? "", /Northwind feedback/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("visible textual matches cannot crowd out an older current-chat source before the search limit", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const old = await source(env, "Northwind questionnaire preserves the original violet ballot.");
    const visible = new Set<string>();
    for (let n = 0; n < 61; n++) {
      const recent = await source(
        env,
        `Northwind questionnaire ${n} discusses a newer maintenance ticket.`,
        old.thread.id,
      );
      visible.add(recent.run.id);
    }
    const snapshot = await recallChats(env.core.store, indexWith([]), "roby", old.thread, "Northwind questionnaire", {
      excludeRuns: visible,
    });
    assert.match(snapshot?.render() ?? "", /original violet ballot/);
    assert.doesNotMatch(snapshot?.render() ?? "", /maintenance ticket/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("queued and running owner messages in the current chat are never historical recall", async () => {
  let release = () => {},
    entered = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const env = await startCore({
    llm: scriptedLlm(async () => {
      entered();
      await waiting;
      return say("ok");
    }),
  });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Northwind questionnaire currently running." });
    await started;
    await env.client.call("threads.send", {
      thread: thread.id,
      text: "Northwind questionnaire future queued instruction.",
    });
    const snapshot = await recallChats(env.core.store, indexWith([]), "roby", thread, "Northwind questionnaire");
    assert.equal(snapshot?.render(), undefined);
    release();
    await env.settle(thread.id);
  } finally {
    release();
    await env.core.close();
    await env.cleanup();
  }
});

test("old and new episodes are indexed independently of an exhausted extraction queue", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const old = await source(env, survey);
    for (let n = 0; n < 80; n++) {
      const id = `capture:backlog:${n}`;
      env.core.store.memoryWork.enqueue({
        id,
        kind: "capture",
        agent_id: "roby",
        thread_id: old.thread.id,
        run_id: old.run.id,
      });
      assert.ok(env.core.store.memoryWork.claim(id));
      if (n < 20) assert.equal(env.core.store.memoryWork.reserve(id, 20), true);
      env.core.store.memoryWork.defer(id, "daily call budget exhausted");
    }
    await env.client.call("memory.reindex", {});
    assert.ok(
      env.core.store.memoryWork.searchEpisodes("Northwind feedback", [old.thread.id]).length,
      "history is indexed even without an auxiliary model or embedding engine",
    );
    const fresh = await source(env, "Acme customer interviews use clickable buttons.");
    assert.ok(
      env.core.store.memoryWork.searchEpisodes("Acme customer", [fresh.thread.id]).length,
      "a new turn never waits behind old extraction jobs",
    );
    assert.equal(env.core.store.memoryWork.reserve("capture:backlog:79", 20), false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("episode scan skips discarded batches, rolls back interrupted progress and survives restart", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  let closed = false;
  try {
    const old = await source(env, survey);
    for (let n = 0; n < 34; n++) await source(env, "Hola");
    const { openDb } = await import("../db/db.ts");
    const { sql, qb } = await import("../domain/sql.ts");
    const db = openDb(env.home),
      q = sql(db);
    q.run(qb.deleteFrom("memory_episode_scans"));
    q.run(qb.deleteFrom("memory_episodes"));
    assert.throws(
      () =>
        env.core.store.memoryWork.checkEpisode(old.run.id, () => {
          env.core.store.memoryWork.episode(old.episode);
          throw new Error("interrupted scan");
        }),
      /interrupted scan/,
    );
    assert.equal(env.core.store.memoryWork.searchEpisodes("Northwind", [old.thread.id]).length, 0);
    assert.ok(env.core.store.memoryWork.uncheckedEpisodes(100).includes(old.run.id));
    db.close();
    await env.core.close();
    closed = true;
    const restarted = await startCore({ home: env.home, llm: scriptedLlm(() => say("ok")) });
    try {
      await restarted.client.call("memory.reindex", {});
      assert.equal(restarted.core.store.memoryWork.searchEpisodes("Northwind", [old.thread.id]).length, 1);
      assert.equal(restarted.core.store.memoryWork.uncheckedEpisodes(100).length, 0);
      await restarted.client.call("memory.reindex", {});
      assert.equal(restarted.core.store.memoryWork.searchEpisodes("Northwind", [old.thread.id]).length, 1);
    } finally {
      await restarted.core.close();
    }
  } finally {
    if (!closed) await env.core.close();
    await env.cleanup();
  }
});

test("recall brings back how the agent did an earlier request: its completed tool calls, not failed or secret ones", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Downloaded it.")) });
  try {
    const old = await source(env, "Download the Acme launch reel from Instagram for me.");
    const store = env.core.store;
    const step = (id: string, tool: string, args: Record<string, unknown>, state: "ok" | "error") => {
      store.runs.beginStep(old.run.id, { call_id: id, tool, args, effect: "none" });
      store.runs.endStep(old.run.id, id, state, state === "ok" ? "done" : "failed");
    };
    step("a", "browser_open", { url: "https://downloader.example.com" }, "error");
    step("b", "browser_open", { url: "https://snapinsta.example.com" }, "ok");
    step("c", "browser_type", { text: "password hunter2" }, "ok");
    step("d", "browser_click", { ref: "download" }, "ok");
    const target = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const snapshot = await recallChats(
      store,
      indexWith([old.episode]),
      "roby",
      target,
      "download the reel like before",
    );
    const text = snapshot?.render() ?? "";
    assert.match(
      text,
      /"your_actions":\["browser_open \{\\"url\\":\\"https:\/\/snapinsta\.example\.com\\"\}","browser_click/,
    );
    assert.match(text, /tool calls you made for them then/);
    assert.doesNotMatch(text, /downloader\.example\.com/, "a failed call is not how it was done");
    assert.doesNotMatch(text, /hunter2/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
