import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import type { CoreEvent } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let release: (() => void) | undefined;
const llm = scriptedLlm(async (_req, { said }) => {
  // "hold" keeps the turn running until the test lets it go.
  if (said.includes("hold")) await new Promise<void>((r) => (release = r));
  return say("ok");
});
let env: Awaited<ReturnType<typeof startCore>>;
const events: CoreEvent[] = [];

before(async () => {
  env = await startCore({ llm });
  env.core.bus.on((e) => void events.push(e));
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const chat = (title?: string) =>
  env.client.call("threads.create", { kind: "agent", agent_id: "scout", ...(title ? { title } : {}) });

test("rename stands over the automatic title; an empty name goes back to it", async () => {
  const t = await chat();
  const named = await env.client.call("threads.update", { thread: t.id, title: "  Trip plans " });
  assert.equal(named.title, "Trip plans");
  assert.equal(named.auto_title, t.title);
  // Activity (the automatic title changing) does not override the owner's name.
  env.core.store.threads.patch(t.id, { title: "Auto name" }, false);
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.title, "Trip plans");
  const reset = await env.client.call("threads.update", { thread: t.id, title: "" });
  assert.equal(reset.title, "Auto name");
  assert.equal(reset.auto_title, undefined);
  const again = await env.client.call("threads.update", { thread: t.id, title: "X" });
  assert.equal((await env.client.call("threads.update", { thread: t.id, title: null })).title, "Auto name");
  assert.equal(again.title, "X");
});

test("pinning does not move the chat in time and lists it first", async () => {
  const old = await chat("old");
  await chat("newer");
  const pinned = await env.client.call("threads.update", { thread: old.id, pinned: true });
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.updated_at, old.updated_at);
  const { threads } = await env.client.call("threads.list", {});
  assert.equal(threads[0]?.id, old.id);
  assert.equal((await env.client.call("threads.update", { thread: old.id, pinned: false })).pinned, undefined);
});

test("archived chats leave the list unless asked for, and come back unarchived", async () => {
  const t = await chat("to archive");
  const seen = events.length;
  const a = await env.client.call("threads.update", { thread: t.id, archived: true });
  assert.equal(a.archived, true);
  assert.ok(events.slice(seen).some((e) => e.type === "thread.updated" && e.thread.archived));
  const ids = async (include_archived?: boolean) =>
    (await env.client.call("threads.list", include_archived ? { include_archived } : {})).threads.map((x) => x.id);
  assert.ok(!(await ids()).includes(t.id));
  assert.ok((await ids(true)).includes(t.id));
  await env.client.call("threads.update", { thread: t.id, archived: false });
  assert.ok((await ids()).includes(t.id));
});

test("Home is never archived or deleted; a task's chat is deleted with its task", async () => {
  await assert.rejects(env.client.call("threads.update", { thread: "home", archived: true }), /Home cannot/);
  await assert.rejects(env.client.call("threads.delete", { thread: "home" }), /Home cannot/);
  assert.equal((await env.client.call("threads.update", { thread: "home", pinned: true })).pinned, true);
  const task = await env.client.call("tasks.create", { title: "Book flights" });
  await assert.rejects(env.client.call("threads.delete", { thread: task.thread_id }), /belongs to a task/);
});

test("delete removes the chat, its sub-threads and what pointed at them", async () => {
  const { store } = env.core;
  const t = await chat("doomed");
  await env.client.call("threads.send", { thread: t.id, text: "zanzibar plans" });
  await env.settle(t.id);
  const child = store.threads.create({ kind: "a2a", title: "sub", agent_ids: ["vera"], parent_id: t.id });
  store.messages.add({ thread_id: child.id, author: { kind: "user" }, parts: [{ type: "text", text: "zanzibar" }] });
  store.notifications.add({ kind: "routine", title: "news", thread_id: t.id });
  const note = store.memories.add({ scope: "global", text: "Likes zanzibar", source: "agent", thread_id: t.id });
  const { media } = await env.client.call("media.upload", {
    name: "a.txt",
    mime: "text/plain",
    data: Buffer.from("hi").toString("base64"),
    thread: t.id,
  });
  const file = store.media.get(media.id)?.path ?? "";
  assert.ok(fs.existsSync(file));
  const unreadBefore = store.notifications.unread();
  const seen = events.length;

  const r = await env.client.call("threads.delete", { thread: t.id }, "del-1");
  assert.deepEqual(r.deleted, [t.id, child.id]);
  assert.equal(store.threads.get(t.id), undefined);
  assert.equal(store.threads.get(child.id), undefined);
  assert.equal(store.runs.list(t.id).length, 0);
  assert.equal(store.messages.list(t.id).length, 0);
  assert.equal(store.media.get(media.id), undefined);
  assert.ok(!fs.existsSync(file));
  assert.equal(store.notifications.unread(), unreadBefore - 1);
  assert.equal(store.memories.get(note.id)?.thread_id, undefined);
  assert.ok(!(await env.client.call("threads.search", { query: "zanzibar" })).hits.length);
  assert.ok(
    events
      .slice(seen)
      .some((e) => e.type === "thread.deleted" && e.thread_id === t.id && e.children.includes(child.id)),
  );
  // The same key replays the answer; a new one finds nothing left.
  assert.deepEqual(await env.client.call("threads.delete", { thread: t.id }, "del-1"), r);
  await assert.rejects(env.client.call("threads.delete", { thread: t.id }), /not found|thread/);
});

test("delete refuses while a turn runs, and works once it ends", async () => {
  const t = await chat("busy");
  await env.client.call("threads.send", { thread: t.id, text: "hold on" });
  const until = Date.now() + 3000;
  while (!release && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(env.client.call("threads.delete", { thread: t.id }), /running/);
  release?.();
  await env.settle(t.id);
  assert.deepEqual((await env.client.call("threads.delete", { thread: t.id })).deleted, [t.id]);
});

test("a fork copies the chat up to a message, and the agent there sees only that much", async () => {
  const t = await chat("to fork");
  const send = async (text: string) => {
    await env.client.call("threads.send", { thread: t.id, text });
    return (await env.settle(t.id)).messages;
  };
  await send("first question");
  const all = await send("second question");
  const firstAnswer = all.find((m) => m.author.kind === "agent");
  const second = all.findLast((m) => m.author.kind === "user");
  assert.ok(firstAnswer && second);

  // At an answer: everything up to it, the original untouched.
  const a = await env.client.call("threads.fork", { thread: t.id, message: firstAnswer.id, title: "Branch" });
  assert.equal(a.thread.title, "Branch");
  assert.equal(a.draft, undefined);
  const copied = (await env.client.call("threads.get", { thread: a.thread.id })).messages;
  assert.equal(copied.length, 2);
  assert.equal((await env.client.call("threads.get", { thread: t.id })).messages.length, all.length);

  // The fork's next turn sees the first exchange, not the second question.
  await env.client.call("threads.send", { thread: a.thread.id, text: "follow-up" });
  await env.settle(a.thread.id);
  const seen = JSON.stringify(llm.calls.at(-1)?.messages);
  assert.match(seen, /first question/);
  assert.doesNotMatch(seen, /second question/);

  // At the owner's message: up to just before it, its words handed back.
  const b = await env.client.call("threads.fork", { thread: t.id, message: second.id });
  assert.equal(b.draft, "second question");
  assert.equal((await env.client.call("threads.get", { thread: b.thread.id })).messages.length, 2);
});
