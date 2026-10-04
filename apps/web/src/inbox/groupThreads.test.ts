import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { archivedThreads, groupByAgent, groupByProject, groupByTime, pinnedFirst } from "./groupThreads.ts";

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
