import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { groupByAgent } from "./groupThreads.ts";

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
