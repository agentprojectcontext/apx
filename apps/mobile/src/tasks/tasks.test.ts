import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../hooks/useWorkspace";
import { translator } from "../i18n/index.ts";
import type { Message } from "../protocol.ts";
import { clockValue, dayValue, monthWeeks, withTime } from "./calendar.ts";
import { taskComments } from "./comments.ts";
import { applyPatch, assignableAgents, columnName, taskValues } from "./fields.ts";

const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({ id, name: id, ...extra });

test("a project's task goes to its team and the super-agent; a global one to agents outside projects", () => {
  const agents = [
    agent("zed"),
    agent("roby", { kind: "secretary" }),
    agent("ada", { project_id: "p1" }),
    agent("bob", { project_id: "p2" }),
  ];
  assert.deepEqual(
    assignableAgents(agents, "p1").map((a) => a.id),
    ["roby", "ada"],
  );
  assert.deepEqual(
    assignableAgents(agents).map((a) => a.id),
    ["roby", "zed"],
  );
});

test("default columns read in the owner's language, the owner's own keep their name", () => {
  const es = translator("es");
  assert.equal(columnName({ id: "backlog", label: "Backlog" }, es), "Por planificar");
  assert.equal(columnName({ id: "qa", label: "QA" }, es), "QA");
});

test("a month's weeks start on Monday, with blanks around it", () => {
  // October 2026 starts on a Thursday and has 31 days.
  const weeks = monthWeeks(2026, 9);
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks[0], [null, null, null, 1, 2, 3, 4]);
  assert.deepEqual(weeks[4], [26, 27, 28, 29, 30, 31, null]);
  // February 2027 starts on a Monday: four full weeks.
  assert.deepEqual(monthWeeks(2027, 1).at(-1), [22, 23, 24, 25, 26, 27, 28]);
});

test("picker values: a bare day, a day at a time, and times typed loosely", () => {
  assert.equal(dayValue(2026, 0, 5), "2026-01-05");
  assert.equal(withTime("2026-01-05", undefined), "2026-01-05");
  assert.equal(withTime("2026-01-05", "18:30"), "2026-01-05T18:30");
  assert.equal(clockValue("8:05"), "08:05");
  assert.equal(clockValue("18.30"), "18:30");
  assert.equal(clockValue("24:00"), undefined);
  assert.equal(clockValue("tarde"), undefined);
});

test("a stored task reads as the rows' values: an unknown priority is normal, a 09:00 due date a bare day", () => {
  const due = new Date(2026, 9, 5, 9, 0).toISOString();
  assert.deepEqual(
    taskValues({ status: "todo", kind: "task", priority: "someday", project_id: "p1", assignee: "ada", due_at: due }),
    { status: "todo", kind: "task", priority: "normal", project: "p1", assignee: "ada", due: "2026-10-05" },
  );
});

test("a new task's form takes each change; null clears, absent keeps", () => {
  const start = {
    status: "backlog",
    kind: "task" as const,
    priority: "normal" as const,
    assignee: "ada",
    project: "p1",
  };
  const due = new Date(2026, 9, 5, 18, 30).toISOString();
  const next = applyPatch(start, { priority: "high", due_at: due, assignee: null });
  assert.deepEqual(next, { ...start, priority: "high", assignee: undefined, due: "2026-10-05T18:30" });
  assert.equal(applyPatch(next, { due_at: null }).due, undefined);
  assert.equal(applyPatch(next, { status: "doing" }).project, "p1");
});

test("a task's comments are the owner's and agents' written words, oldest first", () => {
  const msg = (id: string, author: Message["author"], parts: Message["parts"]): Message => ({
    id,
    thread_id: "th",
    seq: 0,
    author,
    parts,
    created_at: `2026-10-0${id}T10:00:00Z`,
  });
  const comments = taskComments([
    msg("1", { kind: "user" }, [{ type: "text", text: "  @vera can you look?  " }]),
    msg("2", { kind: "system" }, [{ type: "text", text: "Moved to Doing" }]),
    msg("3", { kind: "agent", id: "vera" }, [
      { type: "text", text: "On it." },
      { type: "text", text: "Done." },
    ]),
    msg("4", { kind: "agent", id: "vera" }, []),
  ]);
  assert.deepEqual(comments, [
    { id: "1", by: "owner", text: "@vera can you look?", at: "2026-10-01T10:00:00Z" },
    { id: "3", by: "vera", text: "On it.\n\nDone.", at: "2026-10-03T10:00:00Z" },
  ]);
});
