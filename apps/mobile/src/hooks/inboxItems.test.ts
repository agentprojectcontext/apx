import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxItems } from "./inboxItems.ts";
import type { Notice, PendingInput, Routine, Thread, Workspace } from "./useWorkspace";

const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  kind: "loose",
  title: `Chat ${id}`,
  agent_ids: ["agent-1"],
  state: "idle",
  preview: "",
  unread: 0,
  updated_at: "2026-10-07T10:00:00Z",
  ...extra,
});
const notice = (id: string, extra: Partial<Notice>): Notice => ({
  id,
  kind: "agent",
  level: "info",
  title: id,
  body: "",
  created_at: "2026-10-07T10:00:00Z",
  ...extra,
});
const input = (id: string, extra: Partial<PendingInput> = {}): PendingInput => ({
  id,
  run_id: "run",
  thread_id: "t1",
  agent_id: "agent-1",
  kind: "confirm",
  prompt: `Publish ${id}?`,
  state: "pending",
  ...extra,
});
const data = (extra: Partial<Workspace>) => ({
  notices: [],
  inputs: [],
  threads: [thread("t1", { project_id: "p1" })],
  projects: [{ id: "p1", name: "Acme" }],
  routines: [],
  tasks: [],
  ...extra,
});

test("a pending confirmation is an approval card that approves in place, ahead of the notices", () => {
  const items = inboxItems(
    data({
      inputs: [input("i1"), input("i2", { state: "answered" })],
      notices: [
        notice("n-input", { kind: "input", ref: "i1", created_at: "2026-10-07T09:00:00Z" }),
        notice("n-agent", { thread_id: "t1", created_at: "2026-10-07T11:00:00Z" }),
      ],
    }),
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["input:i1", "notice:n-agent"],
  );
  const [approval] = items;
  assert.equal(approval?.label, "inboxApproval");
  assert.equal(approval?.context, "Acme · Chat t1");
  assert.deepEqual(approval?.primary.action, { kind: "approve", input: "i1" });
  assert.equal(approval?.notice?.id, "n-input");
});

test("a confirmation that can last longer offers approving for the session and always", () => {
  const [item] = inboxItems(data({ inputs: [input("c", { approval_scopes: ["once", "session", "always"] })] }));
  assert.equal(item?.primary.label, "approveOnce");
  assert.deepEqual(
    item?.more?.map((m) => m.action),
    [
      { kind: "approve", input: "c", scope: "session" },
      { kind: "approve", input: "c", scope: "always" },
    ],
  );
});

test("a question opens its chat to answer and shows its options", () => {
  const [item] = inboxItems(data({ inputs: [input("q", { kind: "question", options: ["Yes", "No"] })] }));
  assert.equal(item?.label, "inboxQuestion");
  assert.equal(item?.quote, "Yes · No");
  assert.deepEqual(item?.primary.action, { kind: "open", thread: "t1" });
});

test("read notices leave; a failed routine offers to run it again", () => {
  const routine = { id: "r1", name: "backup-db", last: { run_id: "run-9" } } as Routine;
  const renamed = { id: "r2", name: "old-name" } as Routine;
  const items = inboxItems(
    data({
      routines: [renamed, routine],
      notices: [
        notice("old", { read_at: "2026-10-07T10:30:00Z" }),
        notice("fail", { kind: "routine", level: "error", title: "old-name", ref: "run-9", thread_id: "t1" }),
      ],
    }),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.label, "inboxFailed");
  assert.equal(items[0]?.tone, "danger");
  assert.deepEqual(items[0]?.primary.action, { kind: "rerun", routine: "r1" });
});

test("a task waiting on the owner reads as blocked and opens its conversation", () => {
  const [item] = inboxItems(data({ notices: [notice("task", { kind: "task", thread_id: "t1", ref: "task-1" })] }));
  assert.equal(item?.label, "inboxBlocked");
  assert.equal(item?.tone, "warning");
  assert.deepEqual(item?.primary.action, { kind: "open", thread: "t1" });
});

test("a finished run opens its chat; a failed one reads as failed; a session shows its terminal", () => {
  const items = inboxItems(
    data({
      threads: [thread("t1"), thread("s1", { kind: "code", title: "Claude Code" })],
      notices: [
        notice("ok", { kind: "run", thread_id: "t1", created_at: "2026-10-07T12:00:00Z" }),
        notice("bad", { kind: "run", level: "error", thread_id: "s1", created_at: "2026-10-07T11:00:00Z" }),
        notice("code", { kind: "run", thread_id: "s1", created_at: "2026-10-07T10:00:00Z" }),
      ],
    }),
  );
  assert.deepEqual(
    items.map((item) => [item.label, item.tone, item.icon]),
    [
      ["inboxFinished", "brand", undefined],
      ["inboxFailed", "danger", "TriangleAlert"],
      ["inboxFinished", "brand", "Terminal"],
    ],
  );
  assert.equal(items[0]?.agentId, "agent-1");
  assert.deepEqual(items[0]?.primary.action, { kind: "open", thread: "t1" });
});

test("a kind this app does not know yet shows as a plain notice with the generic icon", () => {
  const [item] = inboxItems(data({ notices: [notice("x", { kind: "engine", thread_id: "t1" })] }));
  assert.equal(item?.label, "inboxNotice");
  assert.equal(item?.icon, "Bell");
});

test("a delegated session a limit stopped offers Continue on its card; other agent notices stay plain", () => {
  const items = inboxItems(
    data({
      notices: [
        notice("stuck", { level: "warn", thread_id: "t1", ref: "th_sub", body: "Cody ran out of steps" }),
        notice("news", { level: "warn", thread_id: "t1" }),
      ],
    }),
  );
  const stuck = items.find((i) => i.id === "notice:stuck");
  assert.equal(stuck?.label, "inboxStopped");
  assert.deepEqual(stuck?.primary, { label: "delegationContinue", action: { kind: "continue", session: "th_sub" } });
  assert.deepEqual(stuck?.secondary.action, { kind: "open", thread: "th_sub" });
  assert.notEqual(items.find((i) => i.id === "notice:news")?.primary.label, "delegationContinue");
});
