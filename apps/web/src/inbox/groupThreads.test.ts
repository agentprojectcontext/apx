import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import {
  archivedThreads,
  bundleTasks,
  delegatedByChat,
  groupByAgent,
  groupByProject,
  groupByTime,
  listedThreads,
  pinnedFirst,
  standsAlone,
  unreadListed,
} from "./groupThreads.ts";

const thread = (id: string, extra: Partial<Thread> = {}): Thread =>
  ({
    id,
    kind: "loose",
    title: id,
    agent_ids: ["roby"],
    state: "completed",
    preview: "",
    unread: 0,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: `2026-10-0${id.length}T10:00:00Z`,
    ...extra,
  }) as Thread;

test("a Claude Code or Codex session sits under its engine, not under the agent that holds it", () => {
  const trees = groupByAgent(
    {
      a: thread("a"),
      bb: thread("bb", { kind: "code", engine: "codex", cwd: "/work/acme" }),
      ccc: thread("ccc", { kind: "code", cwd: "/work/acme" }),
    },
    [],
    {},
  );
  const branches = trees[0]?.agents.map((b) => [b.agentId, b.engine, b.threads.map((t) => t.id)]);
  assert.deepEqual(branches, [
    ["roby", undefined, ["ccc", "a"]],
    ["engine:codex", "codex", ["bb"]],
  ]);
});

test("channel conversations keep their own tree identity instead of nesting under their responding agent", () => {
  const trees = groupByAgent(
    {
      a: thread("a"),
      bb: thread("bb", { channel: { id: "line", conversation: "contact" } }),
      ccc: thread("ccc", { channel: { id: "community", conversation: "room" } }),
      dddd: thread("dddd", { task_id: "task-example", channel: { id: "line", conversation: "task" } }),
    },
    [],
    {},
  );
  assert.deepEqual(
    trees[0]?.agents.map((b) => [b.agentId, !!b.channel, b.threads.map((t) => t.id)]),
    [
      ["task:task-example", false, ["dddd"]],
      ["channel:ccc", true, ["ccc"]],
      ["channel:bb", true, ["bb"]],
      ["roby", false, ["a"]],
    ],
  );
});

test("pinned chats come first within their group, newest first among each kind", () => {
  const list = [thread("a"), thread("bb", { pinned: true }), thread("ccc"), thread("dddd", { pinned: true })];
  assert.deepEqual(
    [...list].sort(pinnedFirst).map((t) => t.id),
    ["dddd", "bb", "ccc", "a"],
  );
});

test("a pinned chat tops its agent's branch and its project group, without reordering the groups", () => {
  const threads = {
    a: thread("a", { pinned: true }),
    bb: thread("bb", { agent_ids: ["vera"] }),
    ccc: thread("ccc"),
  };
  const branches = groupByAgent(threads, [], {})[0]?.agents.map((b) => [b.agentId, b.threads.map((t) => t.id)]);
  assert.deepEqual(branches, [
    ["roby", ["a", "ccc"]],
    ["vera", ["bb"]],
  ]);
  assert.deepEqual(
    groupByProject(threads, [], {})[0]?.threads.map((t) => t.id),
    ["a", "ccc", "bb"],
  );
});

test("Activity puts pinned chats on top; archived chats leave every view and list apart", () => {
  const threads = {
    a: thread("a", { pinned: true }),
    bb: thread("bb", { state: "working" }),
    ccc: thread("ccc", { archived: true }),
  };
  const groups = groupByTime(threads, {}, new Date("2026-10-04T12:00:00Z"));
  assert.deepEqual(
    groups.map((g) => [g.bucket, g.threads.map((t) => t.id)]),
    [
      ["pinned", ["a"]],
      ["running", ["bb"]],
    ],
  );
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
  const ids = (routines: boolean) =>
    groupByTime(all, { routines })
      .flatMap((g) => g.threads.map((t) => t.id))
      .sort();
  assert.deepEqual(ids(false), ["a"]);
  assert.deepEqual(ids(true), ["a", "bb", "eeeee"]);
  assert.deepEqual(
    groupByProject(all, [], { routines: true })[0]
      ?.threads.map((t) => t.id)
      .sort(),
    ["a", "bb", "eeeee"],
  );
});

test("a task's chats hang under the task in the tree, whoever works them, and are one row in a list", () => {
  const trees = groupByAgent(
    {
      a: thread("a", { task_id: "task_1" }),
      bb: thread("bb", { agent_ids: ["vera"], task_id: "task_1" }),
      ccc: thread("ccc"),
    },
    [],
    {},
  );
  assert.deepEqual(
    trees[0]?.agents.map((b) => [b.agentId, b.task, b.threads.map((t) => t.id)]),
    [
      ["roby", undefined, ["ccc"]],
      ["task:task_1", "task_1", ["bb", "a"]],
    ],
  );
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

test("a chat's delegated chats hang under it, newest first, in every view, and never as rows of their own", () => {
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
  const rows = groupByTime(threads, {}, new Date("2026-10-09T12:00:00Z")).flatMap((g) => g.threads.map((t) => t.id));
  assert.deepEqual(rows.sort(), ["dddd", "home"]);
  assert.deepEqual(
    groupByProject(threads, [], {})[0]
      ?.threads.map((t) => t.id)
      .sort(),
    ["dddd", "home"],
  );
  assert.deepEqual(
    groupByAgent(threads, [], {})[0]
      ?.agents.flatMap((b) => b.threads.map((t) => t.id))
      .sort(),
    ["dddd", "home"],
  );
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
  assert.deepEqual(
    groupByProject(threads, [], { projectId: "p_acme" })[0]
      ?.threads.map((t) => t.id)
      .sort(),
    ["mine", "sub"],
  );
  const inbox = groupByProject(threads, [], {}).flatMap((g) => g.threads.map((t) => t.id));
  assert.equal(inbox.includes("sub"), false, "listed once, under its caller");
});
