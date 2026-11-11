import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, Thread } from "@apx/protocol";
import { helperGaps, waitingOf } from "./overviewData.ts";

const task = (over: Partial<Task>): Task => ({
  id: "t1",
  title: "x",
  description: "",
  status: "todo",
  state: "open",
  kind: "task",
  priority: "normal",
  tags: [],
  thread_id: "th1",
  awaits_owner: false,
  renegotiated: 0,
  chats: 0,
  created_by: "owner",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  activity_at: "2026-10-01T10:00:00Z",
  ...over,
});
const chat = (id: string, state: Thread["state"]) => ({ id, state }) as Thread;

test("what waits for the owner is this project's open tasks for them and the chats asking them, newest first", () => {
  const tasks = [
    task({ id: "a", project_id: "p1", awaits_owner: true, activity_at: "2026-10-01T10:00:00Z" }),
    task({ id: "b", project_id: "p1", status: "review", activity_at: "2026-10-02T10:00:00Z" }),
    task({ id: "c", project_id: "p1" }),
    task({ id: "d", project_id: "p2", awaits_owner: true }),
    task({ id: "e", project_id: "p1", awaits_owner: true, state: "done" }),
  ];
  const chats = [chat("x", "input-required"), chat("y", "working"), chat("z", "completed")];
  const w = waitingOf(tasks, chats, "p1", false);
  assert.deepEqual(
    w.tasks.map((t) => t.id),
    ["b", "a"],
    "a review with no agent to do it is the owner's; another project's and a closed one are not",
  );
  assert.deepEqual(
    w.chats.map((c) => c.id),
    ["x"],
  );
  assert.equal(w.open, 3, "the open tasks of this project, waiting or not");
});

test("in the base project, what waits is the tasks with no project", () => {
  const tasks = [task({ id: "a", awaits_owner: true }), task({ id: "b", project_id: "p1", awaits_owner: true })];
  assert.deepEqual(
    waitingOf(tasks, [], "~default", true).tasks.map((t) => t.id),
    ["a"],
  );
});

test("the review card names each gap once, an agent's role and instructions together", () => {
  assert.deepEqual(helperGaps({ missing: [], agent_gaps: [] }), []);
  assert.deepEqual(
    helperGaps({
      missing: ["goal", "first_result"],
      agent_gaps: [
        { id: "a1", name: "Ezra", missing: ["role", "instructions"] },
        { id: "a2", name: "Pia", missing: ["role"] },
        { id: "a3", name: "Uma", missing: ["instructions"] },
      ],
    }),
    [
      { key: "helper.gap.goal" },
      { key: "helper.gap.start" },
      { key: "helper.gap.agentBoth", name: "Ezra" },
      { key: "helper.gap.agentRole", name: "Pia" },
      { key: "helper.gap.agentInstructions", name: "Uma" },
    ],
  );
});
