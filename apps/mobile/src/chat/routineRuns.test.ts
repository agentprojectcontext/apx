import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "../hooks/useWorkspace";
import type { RoutineRun } from "../protocol";
import { runChoices } from "./routineRuns.ts";

const chat = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: id,
  kind: "routine",
  routine_id: "r_daily",
  preview: `said in ${id}`,
  state: "completed",
  agent_ids: ["agent_a"],
  unread: 0,
  updated_at: "2026-11-08T09:00:00Z",
  ...patch,
});
const run = (thread_id: string, started_at: string, state = "completed"): RoutineRun =>
  ({ run_id: `run_${thread_id}`, thread_id, state, started_at }) as RoutineRun;

test("a routine's runs list each chat once, newest first, from the core's runs and the chats on the phone", () => {
  const today = chat("today", { updated_at: "2026-11-09T09:05:00Z", unread: 2 });
  const choices = runChoices(
    today,
    [today, chat("yesterday"), chat("other_routine", { routine_id: "r_other" }), chat("plain", { kind: "chat" })],
    [run("today", "2026-11-09T09:00:00Z"), run("older", "2026-11-07T09:00:00Z", "failed"), run("today", "x")],
  );
  assert.deepEqual(
    choices.map((c) => c.thread_id),
    ["today", "yesterday", "older"],
  );
  assert.equal(choices[0]?.at, "2026-11-09T09:00:00Z");
  assert.equal(choices[0]?.unread, 2);
  assert.equal(choices[2]?.state, "failed");
  assert.equal(choices[2]?.preview, "");
});

test("a chat that is not a routine run has no runs to pick", () => {
  assert.deepEqual(runChoices(chat("plain", { kind: "chat" }), [], [run("plain", "2026-11-09T09:00:00Z")]), []);
});
