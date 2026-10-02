import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskEvent } from "@apx/protocol";
import { historyLines } from "./history.ts";

const columns = [
  { id: "backlog", label: "Backlog" },
  { id: "review", label: "Review" },
];
const names = {
  column: (id: string) => ({ backlog: "Pending", review: "Review" })[id] ?? id,
  agent: (id: string) => ({ roby: "Roby" })[id] ?? id,
  project: (id: string | null) => id ?? "Default",
  priority: (p: string) => p.toUpperCase(),
  when: () => "Sat 3",
};
const ev = (op: TaskEvent["op"], by: string, data: Record<string, unknown> = {}): TaskEvent => ({
  at: "2026-10-02T10:00:00Z",
  op,
  by,
  data,
});

test("history says who did what, by name, and where a move came from", () => {
  const lines = historyLines(
    [
      ev("create", "owner", { status: "backlog" }),
      ev("assign", "owner", { assignee: "roby" }),
      ev("move", "roby", { status: "review" }),
      ev("update", "owner", { priority: "high" }),
      ev("update", "owner", { due_at: "2026-10-03T12:00:00Z" }),
      ev("update", "owner", { due_at: null }),
      ev("update", "owner", { project_id: null }),
      ev("update", "owner", { title: "x" }),
      ev("assign", "owner", { assignee: null }),
      ev("done", "roby"),
    ],
    columns,
    names,
  );
  assert.deepEqual(
    lines.map((l) => [l.by, l.key, l.vars]),
    [
      ["owner", "create", {}],
      ["owner", "assign", { agent: "Roby" }],
      ["roby", "move", { from: "Pending", to: "Review" }],
      ["owner", "priority", { priority: "HIGH" }],
      ["owner", "due", { when: "Sat 3" }],
      ["owner", "undue", {}],
      ["owner", "project", { project: "Default" }],
      ["owner", "edit", {}],
      ["owner", "unassign", {}],
      ["roby", "done", {}],
    ],
  );
});
