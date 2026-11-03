import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { type TempDir, tempDir, waitFor } from "../testkit/platform.ts";
import { taskBlock } from "./office.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// The super-agent turns the owner's request into a brief that asks for more than they said (DECISIONS.md#d-187).
const llm = scriptedLlm(async (req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 200)}`);
  if (said.includes("hand the cursor work to Vera"))
    return callTool("c1", "task_create", {
      title: "Smooth pointer for computer use",
      assignee: "vera",
      goal: "Computer use moves like the reference: an animated cursor with one label per agent",
      description: "- Real pointer only\n- No drawn cursor on top",
    });
  if (said.includes("file it without a goal"))
    return callTool("c2", "task_create", { title: "Pointer without an arrival point", assignee: "vera" });
  const add = /add this to (task_\w+)/.exec(said);
  if (add) return callTool("c3", "task_comment", { task: add[1], text: "Owner adds: it must look animated." });
  const urgent = /make (task_\w+) urgent/.exec(said);
  if (urgent) return callTool("c4", "task_update", { task: urgent[1], priority: "urgent" });
  if (req.messages[0]?.content?.toString().startsWith("You are Vera") && said.includes("Recount the stock"))
    return callTool("c7", "task_comment", {
      task: env.core.store.tasks.list({ limit: 50 }).find((t) => t.title === "Stock count")?.id ?? "",
      text: "Started on the count.",
    });
  if (said.includes("ask Vera to note it"))
    return callTool("c5", "delegate", { agent: "vera", task: "note it as a task" });
  if (said.includes("note it as a task"))
    return callTool("c6", "task_create", { title: "Note from a teammate", goal: "A note exists" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo: TempDir;
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = tempDir("apx-asked-");
  fs.writeFileSync(path.join(repo.path, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo.path })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

const ownerSays = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
};
const taskTitled = async (title: string) =>
  (await env.client.call("tasks.list", { project })).tasks.find((t) => t.title === title);

test("the owner's words travel with the task they asked for, and its agent reads them and the goal before the brief", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: project });
  await ownerSays(chat.id, "Our computer use is so-so; the open-source repo could help.");
  await ownerSays(chat.id, "Its cursor moves smoothly and animated, hand the cursor work to Vera");
  const t = await taskTitled("Smooth pointer for computer use");
  assert.ok(t, "the task was created");
  assert.equal(t.goal, "Computer use moves like the reference: an animated cursor with one label per agent");
  // The request and the message just before it ("the repo"), as written, passed on by the super-agent.
  assert.deepEqual(
    t.asked?.map((a) => [a.text, a.by]),
    [
      ["Our computer use is so-so; the open-source repo could help.", "superagent"],
      ["Its cursor moves smoothly and animated, hand the cursor work to Vera", "superagent"],
    ],
  );
  const work = env.core.store.threads.byTask(t.id)[0];
  assert.ok(work, "Vera has a chat for it");
  const block = taskBlock(env.core.store, work) ?? "";
  const at = (s: string) => block.indexOf(s);
  assert.ok(at("Goal, where this work must arrive") > 0, block);
  assert.ok(at("Its cursor moves smoothly and animated") > at("Goal, where this work must arrive"), block);
  assert.ok(at("Brief by") > at("Its cursor moves smoothly and animated"), block);
  assert.match(block, /follow the owner and say so on the task/);
});

test("a task handed to an agent needs a goal; the refusal says what to give", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: project });
  await ownerSays(chat.id, "file it without a goal");
  assert.equal(await taskTitled("Pointer without an arrival point"), undefined);
  const refusal = llm.calls
    .flatMap((c) => c.messages)
    .find((m) => m.role === "tool" && /goal: say in a line where this work must arrive/.test(String(m.content)));
  assert.ok(refusal, "the agent was told to give a goal");
});

test("what the owner adds later through an agent joins the task once; their words in the task's own chat stay there", async () => {
  const t = await taskTitled("Smooth pointer for computer use");
  assert.ok(t);
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: project });
  await ownerSays(chat.id, `It must look animated, add this to ${t.id}`);
  await ownerSays(chat.id, `make ${t.id} urgent`);
  await env.client.call("tasks.comment", { task: t.id, text: "Said in the task itself" });
  const now = await env.client.call("tasks.get", { task: t.id });
  const said = now.task.asked?.map((a) => a.text) ?? [];
  assert.equal(said.filter((s) => s === `It must look animated, add this to ${t.id}`).length, 1);
  assert.ok(!said.includes("Said in the task itself"));
  // An update that rewrites nothing the task asks keeps no request: the owner's "make … urgent" is not kept as one.
  assert.ok(!said.includes(`make ${t.id} urgent`));
  assert.equal(now.task.priority, "urgent");
});

test("a task an agent creates for another agent carries no owner's words", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: project });
  await ownerSays(chat.id, "ask Vera to note it");
  await waitFor(async () => Boolean(await taskTitled("Note from a teammate")), "Vera's task");
  const t = await taskTitled("Note from a teammate");
  assert.equal(t?.created_by, "vera");
  assert.equal(t?.asked, undefined);
});

test("the work APX starts on a task the owner gave is not their words", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Stock count",
    goal: "The stock is counted",
    description: "Recount the stock in the shop.",
    project,
    assignee: "vera",
  });
  await waitFor(
    () =>
      env.core.store.messages
        .list(t.thread_id, 50)
        .some((m) => JSON.stringify(m.parts).includes("Started on the count")),
    "Vera's comment",
  );
  assert.equal((await env.client.call("tasks.get", { task: t.id })).task.asked, undefined);
});
