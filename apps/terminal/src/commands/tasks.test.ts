import assert from "node:assert/strict";
import { test } from "node:test";
import { taskEditOf, tasks } from "./tasks.ts";
import { printed, recordingClient } from "./testing.ts";

const task = {
  id: "tsk_1",
  title: "Send the Acme quote",
  description: "Prices for the Northwind order.",
  status: "doing",
  state: "open",
  kind: "task",
  priority: "normal",
  tags: ["sales", "q4"],
  assignee: "april",
  thread_id: "thr_t",
  awaits_owner: false,
  due_at: "2026-10-05T12:00:00.000Z",
  renegotiated: 0,
  created_by: "owner",
  created_at: "2026-10-01T12:00:00.000Z",
  updated_at: "2026-10-01T12:00:00.000Z",
  chats: 1,
  activity_at: "2026-10-01T12:00:00.000Z",
};
const message = (seq: number, author: unknown, text: string) => ({
  id: `msg_${seq}`,
  thread_id: "thr_t",
  seq,
  author,
  parts: [{ type: "text", text }],
  created_at: "2026-10-02T12:00:00.000Z",
});

test("board groups project tasks by column and marks tasks waiting for the owner", async () => {
  const { client, calls } = recordingClient({
    "tasks.list": {
      tasks: [task, { ...task, id: "tsk_2", title: "Check the quote", status: "review", awaits_owner: true }],
      columns: [
        { id: "doing", label: "Doing" },
        { id: "review", label: "Review" },
        { id: "backlog", label: "Backlog" },
      ],
    },
  });
  const out = await printed(() => tasks(client, [], { project: "acme" }));
  assert.match(out, /Doing\n {2}tsk_1 {2}Send the Acme quote {2}· april/);
  assert.match(out, /Review\n {2}tsk_2 {2}Check the quote {2}· april {2}· waiting for you/);
  assert.ok(!out.includes("Backlog"));
  assert.deepEqual(calls, [["tasks.list", { project: "acme" }]]);
});

test("commitments separate what the owner owes from what other people owe", async () => {
  const { client, calls } = recordingClient({
    "tasks.list": {
      tasks: [
        { ...task, kind: "commitment", person_name: "Acme", owed_by: "owner" },
        {
          ...task,
          id: "tsk_2",
          title: "Receive the receipt",
          kind: "commitment",
          person_name: "Northwind",
          owed_by: "person",
          due_at: undefined,
        },
      ],
      columns: [],
    },
  });
  const out = await printed(() => tasks(client, ["commitments"], {}));
  assert.match(out, /You owe\n {2}tsk_1 {2}Send the Acme quote {2}· Acme {2}· due /);
  assert.match(out, /Owed to you\n {2}tsk_2 {2}Receive the receipt {2}· Northwind$/);
  assert.deepEqual(calls, [["tasks.list", { commitments: true }]]);
});

test("edit sends only the fields given", () => {
  assert.deepEqual(taskEditOf("tsk_1", { title: "New title" }), { task: "tsk_1", title: "New title" });
  assert.deepEqual(taskEditOf("tsk_1", { agent: "roby", due: "2026-10-09", tags: " a, b ,," }), {
    task: "tsk_1",
    assignee: "roby",
    due_at: "2026-10-09",
    tags: ["a", "b"],
  });
});

test("edit clears the agent and the due date with an empty value", () => {
  assert.deepEqual(taskEditOf("tsk_1", { agent: "", due: "" }), { task: "tsk_1", assignee: null, due_at: null });
});

test("edit reads the description from a file, never from both places, and refuses an empty edit", () => {
  const read = (f: string) => `from ${f}`;
  assert.deepEqual(taskEditOf("tsk_1", { descFile: "-" }, read), { task: "tsk_1", description: "from -" });
  assert.throws(() => taskEditOf("tsk_1", { desc: "x", descFile: "f" }, read), /not both/);
  assert.throws(() => taskEditOf("tsk_1", {}), /nothing to change/);
});

test("show prints the task's fields, its description and its comments", async () => {
  const { client, calls } = recordingClient({
    "tasks.get": { task, events: [], sessions: [] },
    "threads.get": {
      thread: { id: "thr_t" },
      messages: [
        message(1, { kind: "system" }, "Task created"),
        message(2, { kind: "user" }, "@april use the new prices"),
        message(3, { kind: "agent", id: "april" }, "Done, sent to Acme."),
      ],
      runs: [],
    },
  });
  const out = await printed(() => tasks(client, ["show", "tsk_1"], {}));
  assert.match(out, /^tsk_1 {2}Send the Acme quote/);
  assert.match(out, /Status: +doing/);
  assert.match(out, /Agent: +april/);
  assert.match(out, /Tags: +sales, q4/);
  assert.match(out, /Prices for the Northwind order\./);
  assert.match(out, /Comments[\s\S]*user\n {4}@april use the new prices[\s\S]*april\n {4}Done, sent to Acme\./);
  assert.ok(!out.includes("Task created"), "system notes are not comments");
  assert.deepEqual(calls, [
    ["tasks.get", { task: "tsk_1" }],
    ["threads.get", { thread: "thr_t" }],
  ]);
});

test("edit calls tasks.update; help prints the usage without calling the core", async () => {
  const { client, calls } = recordingClient({ "tasks.update": { ...task, title: "Quote" } });
  assert.match(await printed(() => tasks(client, ["edit", "tsk_1"], { title: "Quote" })), /tsk_1 {2}saved · Quote/);
  assert.deepEqual(calls, [["tasks.update", { task: "tsk_1", title: "Quote" }]]);
  assert.match(await printed(() => tasks(client, ["help"], {})), /apx tasks show <id>/);
  assert.equal(calls.length, 1);
});

test("settle sends the outcome, the new date and the note; an unknown outcome prints the usage", async () => {
  const { client, calls } = recordingClient({ "tasks.settle": { ...task, kind: "commitment" } });
  const out = await printed(() =>
    tasks(client, ["settle", "tsk_1", "renegotiated", "asked", "for", "a", "week"], { due: "2026-10-12" }),
  );
  assert.match(out, /^tsk_1 {2}renegotiated {2}· due /);
  await printed(() => tasks(client, ["settle", "tsk_1", "kept"], {}));
  assert.deepEqual(calls, [
    ["tasks.settle", { task: "tsk_1", outcome: "renegotiated", due_at: "2026-10-12", note: "asked for a week" }],
    ["tasks.settle", { task: "tsk_1", outcome: "kept" }],
  ]);
  await assert.rejects(tasks(client, ["settle", "tsk_1", "later"], {}), /apx tasks settle <id>/);
  assert.equal(calls.length, 2);
});

test("inside an agent's command, closing a task as the owner is refused: the agent closes with task_close", async () => {
  const { client, calls } = recordingClient({});
  const inherited = process.env.APX_AGENT;
  process.env.APX_AGENT = "builder";
  try {
    for (const sub of ["done", "drop", "reopen"])
      await assert.rejects(tasks(client, [sub, "tsk_1"], {}), /use task_close/);
  } finally {
    if (inherited === undefined) delete process.env.APX_AGENT;
    else process.env.APX_AGENT = inherited;
  }
  assert.deepEqual(calls, [], "nothing was closed");
});
