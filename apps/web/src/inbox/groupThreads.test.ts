import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import {
  archivedThreads,
  bundleChats,
  bundleTasks,
  delegatedByChat,
  inboxEntries,
  listedThreads,
  pinnedFirst,
  standsAlone,
  taskTeammates,
  tookPart,
  unreadListed,
  unreadUnder,
  unreadWhere,
} from "./groupThreads.ts";

const thread = (id: string, extra: Partial<Thread> = {}): Thread =>
  ({
    id,
    kind: "loose",
    title: id,
    agent_ids: ["superagent"],
    state: "completed",
    preview: "",
    unread: 0,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: `2026-10-0${id.length}T10:00:00Z`,
    ...extra,
  }) as Thread;

/** The Inbox's rows in order, a bundle's chats in its place. */
const rows = (threads: Record<string, Thread>, opts: Parameters<typeof inboxEntries>[1] = {}) =>
  inboxEntries(threads, opts).flatMap((e) => (e.kind === "thread" ? [e.thread.id] : e.threads.map((t) => t.id)));

test("a tool-started external session stays in its task even without its parent loaded", () => {
  const threads = {
    home: thread("home", { kind: "task" }),
    session: thread("session", {
      kind: "code",
      engine: "claude",
      project_id: "p_acme",
      parent_id: "home",
      cwd: "/different/folder",
      task_id: "task_inventory",
      unread: 2,
    }),
    internal: thread("internal", { kind: "code", project_id: "p_acme", parent_id: "home" }),
  };
  assert.deepEqual(rows(threads, { projectId: "p_acme" }), ["session"]);
  assert.deepEqual(
    listedThreads(threads, { projectId: "p_acme" }).map((t) => t.id),
    ["session"],
  );
  const entries = inboxEntries({ session: threads.session }, { projectId: "p_acme" });
  assert.equal(entries[0]?.kind, "task");
  assert.deepEqual(
    entries.flatMap((e) => (e.kind === "task" ? [e.taskId] : [])),
    ["task_inventory"],
  );
  assert.deepEqual(unreadUnder(threads, [threads.session]), ["session"]);
  assert.deepEqual(
    archivedThreads({ session: { ...threads.session, archived: true } }, { projectId: "p_acme" }),
    [],
    "an archived task session does not leak back into Chats",
  );
});

test("pinned chats come first within their group, newest first among each kind", () => {
  const list = [thread("a"), thread("bb", { pinned: true }), thread("ccc"), thread("dddd", { pinned: true })];
  assert.deepEqual(
    [...list].sort(pinnedFirst).map((t) => t.id),
    ["dddd", "bb", "ccc", "a"],
  );
});

test("a pinned chat tops the list, the rest newest first", () => {
  const threads = {
    a: thread("a", { pinned: true }),
    bb: thread("bb", { agent_ids: ["vera"] }),
    ccc: thread("ccc"),
  };
  assert.deepEqual(rows(threads), ["a", "ccc", "bb"]);
});

test("archived chats leave the list and are listed apart", () => {
  const threads = {
    a: thread("a", { pinned: true }),
    bb: thread("bb", { state: "working" }),
    ccc: thread("ccc", { archived: true }),
  };
  assert.deepEqual(rows(threads), ["a", "bb"]);
  assert.deepEqual(
    archivedThreads(threads, {}).map((t) => t.id),
    ["ccc"],
  );
});

test("routine runs that told something show only when the owner lists them; quiet or running ones never", () => {
  const all = {
    a: thread("a"),
    bb: thread("bb", { kind: "routine", title: "golf · 10/12/26" }),
    ccc: thread("ccc", { kind: "routine", archived: true }),
    dddd: thread("dddd", { kind: "routine", state: "working" }),
    eeeee: thread("eeeee", { kind: "routine", state: "input-required" }),
  };
  const ids = (routines: boolean) => rows(all, { routines }).sort();
  assert.deepEqual(ids(false), ["a"]);
  assert.deepEqual(ids(true), ["a", "bb", "eeeee"]);
});

test("a task's chats are one row in the list, whoever works them", () => {
  const entries = bundleTasks([
    thread("ccc"),
    thread("bb", { task_id: "task_1" }),
    thread("x"),
    thread("a", { task_id: "task_1" }),
  ]);
  assert.deepEqual(
    entries.map((e) =>
      e.kind === "thread"
        ? e.thread.id
        : `${e.kind === "task" ? e.taskId : e.routineId}:${e.threads.map((t) => t.id).join(",")}`,
    ),
    ["ccc", "task_1:bb,a", "x"],
  );
});

test("a chat's delegated chats hang under it, newest first, and never as rows of their own", () => {
  const threads = {
    home: thread("home", { kind: "home" }),
    a: thread("a", { kind: "a2a", parent_id: "home" }),
    ccc: thread("ccc", { kind: "a2a", parent_id: "home" }),
    bb: thread("bb", { kind: "a2a", parent_id: "home", archived: true }),
    dddd: thread("dddd"),
  };
  assert.deepEqual(
    delegatedByChat(threads)
      .get("home")
      ?.map((t) => t.id),
    ["ccc", "a"],
    "archived ones left out",
  );
  assert.equal(delegatedByChat(threads), delegatedByChat(threads), "one pass per snapshot");
  assert.deepEqual(rows(threads).sort(), ["dddd", "home"]);
  // Mark all as read reads what the list shows: the rows and what hangs under them.
  assert.deepEqual(
    listedThreads(threads, {})
      .map((t) => t.id)
      .sort(),
    ["a", "ccc", "dddd", "home"],
  );
  const unread = { ...threads, ccc: { ...threads.ccc, unread: 2 }, dddd: { ...threads.dddd, unread: 1 } };
  assert.deepEqual(unreadListed(unread, {}).sort(), ["ccc", "dddd"], "a delegated chat's unread goes too");
});

test("a chat delegated into a project from Home is listed in that project, and only under Home in the Inbox", () => {
  const threads = {
    home: thread("home", { kind: "home" }),
    sub: thread("sub", { kind: "a2a", parent_id: "home", project_id: "p_acme" }),
    mine: thread("mine", { project_id: "p_acme" }),
    near: thread("near", { kind: "a2a", parent_id: "mine", project_id: "p_acme" }),
    lost: thread("lost", { kind: "a2a", parent_id: "gone" }),
  };
  assert.equal(standsAlone(threads.sub, threads, "p_acme"), true);
  assert.equal(standsAlone(threads.sub, threads), false, "in the Inbox it hangs under Home");
  assert.equal(standsAlone(threads.near, threads, "p_acme"), false, "its caller is in the project too");
  assert.equal(standsAlone(threads.lost, threads), true, "its caller is not loaded");
  assert.deepEqual(rows(threads, { projectId: "p_acme" }).sort(), ["mine", "sub"]);
  assert.equal(rows(threads).includes("sub"), false, "listed once, under its caller");
});

test("chats on one channel account go together where its newest chat is", () => {
  const on = (account: string) => ({ channel: { id: account, conversation: "c1" } }) as Partial<Thread>;
  const list = [
    thread("a", on("wa_sales")),
    thread("b"),
    thread("c", on("mail")),
    thread("d", on("wa_sales")),
    thread("e", on("wa_home")),
  ];
  const got = bundleChats(list).map(entryId);
  assert.deepEqual(got, ["wa_sales:a,d", "b", "mail:c", "wa_home:e"]);
  assert.deepEqual(bundleChats(list, false).map(entryId), ["a", "b", "c", "d", "e"], "not grouped by account");
});

const entryId = (e: ReturnType<typeof bundleChats>[number]) =>
  e.kind === "thread"
    ? e.thread.id
    : `${e.kind === "channel" ? e.account : "calls"}:${e.threads.map((t) => t.id).join(",")}`;

test("every call goes into one Calls row where the newest call is, grouped by account or not", () => {
  const list = [
    thread("a"),
    thread("b", { kind: "call" }),
    thread("c", { channel: { id: "wa_sales", conversation: "c1" } as Thread["channel"] }),
    thread("d", { kind: "call" }),
  ];
  assert.deepEqual(bundleChats(list).map(entryId), ["a", "calls:b,d", "wa_sales:c"]);
  assert.deepEqual(bundleChats(list, false).map(entryId), ["a", "calls:b,d", "c"]);
});

test("calls with any agent go into the same Calls row", () => {
  const list = [
    thread("b", { kind: "call", agent_ids: ["superagent"] }),
    thread("c", { kind: "call", agent_ids: ["dev"] }),
    thread("d", { kind: "call", agent_ids: ["design"] }),
  ];
  assert.deepEqual(bundleChats(list).map(entryId), ["calls:b,c,d"]);
});

test("what a call asked the super-agent hangs under the call, never as a row of its own", () => {
  const threads = {
    call: thread("call", { kind: "call" }),
    ask: thread("ask", { kind: "agent", parent_id: "call" }),
    other: thread("other", { kind: "agent" }),
  };
  assert.deepEqual(
    delegatedByChat(threads)
      .get("call")
      ?.map((t) => t.id),
    ["ask"],
  );
  assert.deepEqual(rows(threads).sort(), ["call", "other"]);
  assert.equal(standsAlone(threads.ask, { ask: threads.ask }), true, "its call is not loaded");
});

test("one tab's or one section's Mark all as read takes its chats and what hangs under them, nothing else", () => {
  const threads = {
    task: thread("task", { kind: "task", task_id: "t1", unread: 1 }),
    sub: thread("sub", { kind: "a2a", parent_id: "task", unread: 3 }),
    quiet: thread("quiet", { kind: "task", task_id: "t1" }),
    chat: thread("chat", { unread: 2, channel: { id: "acc_1" } as Thread["channel"] }),
    other: thread("other", { unread: 1, channel: { id: "acc_2" } as Thread["channel"] }),
  };
  assert.deepEqual(unreadUnder(threads, [threads.task, threads.quiet]).sort(), ["sub", "task"]);
  assert.deepEqual(unreadUnder(threads, [threads.chat]), ["chat"], "another tab's chats stay unread");
  assert.deepEqual(
    unreadWhere(threads, (t) => t.channel?.id === "acc_1"),
    ["chat"],
  );
  assert.deepEqual(unreadWhere(threads, (t) => !!t.channel).sort(), ["chat", "other"]);
});

test("a task's row counts every agent that took part, its agent first, each once", () => {
  const chats = [thread("a", { agent_ids: ["ramiro"] }), thread("bb", { agent_ids: ["superagent", "ramiro"] })];
  // The core counts the teammates asked on it, whose consults are not the task's chats.
  assert.deepEqual([...tookPart(["ramiro", "bruno"], chats)], ["ramiro", "bruno", "superagent"]);
  // A core that does not count them yet: the chats' agents still are.
  assert.deepEqual([...tookPart(undefined, chats)], ["ramiro", "superagent"]);
});

test("a task's teammates include the chats delegated from any of its chats, not just its home", () => {
  // The task's home chat, and the chat the agent works the task in: delegations made from the second must count too.
  const threads = {
    home: thread("home", { kind: "task", task_id: "task1" }),
    work: thread("work", { task_id: "task1", updated_at: "2026-10-05T10:00:00Z" }),
    design: thread("design", { kind: "a2a", parent_id: "work", updated_at: "2026-10-06T10:00:00Z" }),
    build: thread("build", { kind: "a2a", parent_id: "work", updated_at: "2026-10-07T10:00:00Z" }),
    asked: thread("asked", { kind: "a2a", parent_id: "home", updated_at: "2026-10-04T10:00:00Z" }),
    deeper: thread("deeper", { kind: "a2a", parent_id: "build" }),
    // A delegated chat that is itself one of the task's chats is listed once, as a chat.
    inTask: thread("inTask", { kind: "a2a", parent_id: "home", task_id: "task1" }),
  };
  const got = taskTeammates(threads, "home", [threads.work, threads.inTask], { work: 3, home: 1 });
  assert.deepEqual(
    got.kids.map((t) => t.id),
    ["build", "design", "asked"],
  );
  assert.equal(got.total, 4, "the core counts one more under the working chat than is loaded");
  assert.deepEqual(got.short, ["work"], "the chat whose teammates are not all loaded yet");
  assert.deepEqual(got.chats.sort(), ["home", "inTask", "work"]);
});

test("a task with no home yet still nests what its chats delegated", () => {
  const threads = {
    work: thread("work", { task_id: "task1" }),
    build: thread("build", { kind: "a2a", parent_id: "work" }),
  };
  const got = taskTeammates(threads, undefined, [threads.work], {});
  assert.deepEqual(
    got.kids.map((t) => t.id),
    ["build"],
  );
  assert.equal(got.total, 1);
});
