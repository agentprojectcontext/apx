// An agent working a task from outside its chat (the super-agent on a teammate's result) has a progress comment noted
// where progress lives (the task's history, or its plan's step once it has a plan), and a comment naming an agent of
// another project says how to reach it, instead of a mention it cannot use (DECISIONS.md#d-202, DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TERMINAL } from "../domain/runs.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const results: string[] = [];
let task = "";
let chat = "";
/** Scout answers once the super-agent's turn that asked it has ended, so its answer starts a turn of its own. */
const askerDone = () =>
  waitFor(() => env.core.store.runs.list(chat).every((r) => TERMINAL.has(r.state)), "the asking turn to end");
const PLAN = "- [x] Found the cause\n- [~] Fix it";

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (system.startsWith("You are Scout")) return askerDone().then(() => say("The hinge is loose."));
  if (!system.startsWith("You are Roby")) return say("ok");
  if (said.includes("REACH-CASE"))
    return afterTool
      ? say("Asked Scout.")
      : callTool("d0", "delegate", { agent: "scout", task: "Look at the back door.", wait_s: 0 });
  if (!said.includes("hinge")) return say("ok");
  // The turn on Scout's result: no owner words in it.
  if (afterTool) results.push(String(req.messages.at(-1)?.content));
  const step = results.length;
  if (step === 0) return callTool("c0", "task_comment", { task, text: "Scout found the hinge is loose." });
  if (step === 1) return callTool("c1", "task_comment", { task, text: "@yago is the clinic report in your notes?" });
  if (step === 2) return callTool("u0", "task_update", { task, plan: PLAN });
  if (step === 3) return callTool("c2", "task_comment", { task, text: "Scout tightened the hinge." });
  return say("Recorded.");
});

let env: Awaited<ReturnType<typeof startCore>>;
const folders = [tempDir(), tempDir()];
before(async () => {
  env = await startCore({ llm });
  const [a, b] = folders;
  const { project } = await env.client.call("projects.create", { name: "Acme doors", path: a?.path ?? "" });
  const { project: other } = await env.client.call("projects.create", { name: "Northwind", path: b?.path ?? "" });
  await env.client.call("agents.create", { name: "Yago", slug: "yago", project_id: other.id });
  task = (await env.client.call("tasks.create", { title: "Fix the back door", project: project.id })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  for (const f of folders) await f.remove();
});

test("outside a task's chat, progress is noted on the task's history or plan step, and another project's agent is not reached by a comment", async () => {
  chat = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  await env.client.call("threads.send", { thread: chat, text: "REACH-CASE: check the back door." });
  await waitFor(() => results.length >= 4, "the turn on Scout's result");
  await env.settle(chat);
  const [progress, mention, update, planned] = results;
  // No plan yet: the note goes in the task's history, and the agent is told where progress lives.
  assert.match(
    String(progress),
    /^noted in the task's history, not posted as a comment\. .*task's plan \(task_update plan\)/,
  );
  assert.match(String(mention), /not posted: Yago works in another project.*delegate/);
  assert.match(String(update), /^updated/);
  // With a plan, the note joins the step being done.
  assert.match(String(planned), /^noted on the plan's step "Fix it", not posted as a comment\./);
  assert.equal(
    env.core.store.tasks.get(task)?.plan,
    "- [x] Found the cause\n- [~] Fix it (Scout tightened the hinge.)",
  );
  const events = env.core.store.tasks.events(task);
  assert.ok(events.some((e) => e.by === "superagent" && e.data.note === "Scout found the hinge is loose."));
  assert.equal(events.filter((e) => e.op === "comment").length, 0);
});
