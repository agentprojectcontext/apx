// The subtasks list of an open task refreshes on the live event that already
// refreshes its comment thread.
//
// Demo run of 2026-09-26: the CEO, summoned on a task, created three subtasks
// with its tools. They appeared in the task list next door, but the open
// detail's "Subtasks" section stayed empty until the task was reopened —
// TaskComments listened for the task's live event and re-fetched the PARENT
// and the list, while TaskSubtasks has its own SWR key that nobody told.
// Source contract, like the rest of the web tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("TaskSubtasks revalidates its own list on the task's live event, like the thread does", () => {
  const subs = web("components", "tasks", "TaskSubtasks.tsx");
  const thread = web("components", "tasks", "TaskComments.tsx");
  const predicate = /ev\.scope === "resync" \|\| ev\.thread === taskId/;
  assert.match(thread, predicate, "the thread's trigger (the reference this mirrors)");
  assert.match(subs, /useLiveMessages\(/, "the subtasks list listens to the live feed");
  assert.match(subs, predicate, "on the same event as the thread");
  const listener = subs.slice(subs.indexOf("useLiveMessages(("));
  assert.match(listener.slice(0, listener.indexOf("});")), /mutate\(\)/, "and re-fetches ITS key, not only the parent");
});
