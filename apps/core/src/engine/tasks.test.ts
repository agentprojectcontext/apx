import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Vera and Roby keep mentioning each other: the cascade must stop by itself.
const llm = scriptedLlm((req, { said, afterTool }) => {
  const system = String(req.messages[0]?.content);
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 120)}`);
  if (said.includes("make a task")) return callTool("t1", "task_create", { title: "Draft the launch post" });
  if (said.includes("peek at the other")) return callTool("t2", "task_list", {});
  if (system.startsWith("You are Vera")) return say("Done my part, @roby your turn.");
  if (system.startsWith("You are Roby")) return say("Thanks, back to you @vera.");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("a task keeps its history: created, moved, assigned, done, reopened", async () => {
  const t = await env.client.call("tasks.create", { title: "Ship the newsletter", project });
  assert.equal(t.status, "backlog");
  await env.client.call("tasks.update", { task: t.id, status: "doing" });
  await env.client.call("tasks.update", { task: t.id, assignee: "vera" });
  await env.client.call("tasks.close", { task: t.id, state: "done", note: "sent" });
  await env.client.call("tasks.close", { task: t.id, state: "open" });
  const { task, events } = await env.client.call("tasks.get", { task: t.id });
  assert.deepEqual(
    events.map((e) => e.op),
    ["create", "move", "assign", "done", "reopen"],
  );
  assert.equal(task.state, "open");
  await assert.rejects(
    env.client.call("tasks.update", { task: t.id, status: "nowhere" }),
    (e: unknown) => e instanceof ApxError && /no column/.test(e.message),
  );
});

test("a comment that @mentions an agent runs it in the task's conversation, and the cascade stops", async () => {
  const t = await env.client.call("tasks.create", { title: "Plan the launch", project });
  const r = await env.client.call("tasks.comment", { task: t.id, text: "@vera can you start this?" });
  assert.equal(r.runs.length, 1);
  await env.settle(t.thread_id, 8000);
  const { runs } = await env.client.call("threads.get", { thread: t.thread_id });
  // Owner → Vera (0) → Roby (1) → Vera (2), then no more.
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((x) => x.agent_id).reverse(), ["vera", "roby", "vera"]);
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("@vera can you start this?"));
  assert.match(String(input?.messages.at(-1)?.content), /\[task\]\nPlan the launch\nbacklog · assigned to nobody/);
});

test("an agent's tasks go to its thread's project and it sees no other project's", async () => {
  const other = await env.client.call("tasks.create", { title: "Secret elsewhere" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "make a task" });
  await env.settle(t.id);
  const { tasks } = await env.client.call("tasks.list", { project });
  assert.ok(tasks.some((x) => x.title === "Draft the launch post" && x.created_by === "roby"));

  await env.client.call("tasks.update", { task: other.id, title: "Secret elsewhere" });
  const p2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks2-")));
  fs.writeFileSync(path.join(p2, "AGENTS.md"), "# Globex\n");
  const project2 = (await env.client.call("projects.register", { path: p2 })).project.id;
  await env.client.call("tasks.create", { title: "Globex only", project: project2 });
  await env.client.call("threads.send", { thread: t.id, text: "peek at the other projects" });
  await env.settle(t.id);
  assert.doesNotMatch(String(llm.calls.at(-1)?.messages.at(-1)?.content), /Globex only/);
  fs.rmSync(p2, { recursive: true, force: true });
});

test("outside any project the super-agent sees every project's board, each task with its project and last activity", async () => {
  await env.client.call("tasks.create", { title: "Northwind invoice", project });
  await env.client.call("tasks.create", { title: "Renew the base insurance" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "everything" });
  await env.client.call("threads.send", { thread: t.id, text: "peek at the other projects" });
  await env.settle(t.id);
  const seen = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  const name = (await env.client.call("projects.list", {})).projects.find((p) => p.id === project)?.name ?? "";
  assert.ok(seen.includes(`Northwind invoice (project ${name}, backlog, last activity `), seen);
  assert.match(seen, /last activity \d{4}-\d\d-\d\d \d\d:\d\d\)/);
  assert.match(seen, /Renew the base insurance \(project Default, /);
});

test("what an agent wrote in a task reaches other turns as outside data", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "make a task" });
  await env.settle(t.id);
  const made = (await env.client.call("tasks.list", { project })).tasks.find(
    (x) => x.title === "Draft the launch post",
  );
  if (!made) throw new Error("no task");
  await env.client.call("tasks.comment", { task: made.id, text: "@vera please look" });
  await env.settle(made.thread_id, 8000);
  const input = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("@vera please look"));
  assert.match(
    String(input?.messages.at(-1)?.content),
    /<task created_by="roby" trust="untrusted">\nDraft the launch post/,
  );
});

test("an agent of one project is not assigned another project's task", async () => {
  const p2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks3-")));
  fs.writeFileSync(path.join(p2, "AGENTS.md"), "# Initech\n");
  const other = (await env.client.call("projects.register", { path: p2 })).project.id;
  const milton = await env.client.call("agents.create", { project_id: other, slug: "milton", name: "Milton" });
  await assert.rejects(
    env.client.call("tasks.create", { title: "Elsewhere", project, assignee: milton.id }),
    (e: unknown) => e instanceof ApxError && /another project/.test(e.message),
  );
  fs.rmSync(p2, { recursive: true, force: true });
});
