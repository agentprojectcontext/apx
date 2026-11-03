import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message, Part } from "@apx/protocol";
import { planSteps } from "@apx/protocol/task-plan";
import { type TempDir, tempDir, waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// The agent's plan in any chat: one live checklist under its answer, and in a task's chat the task's own plan
// (DECISIONS.md#d-191).
const PLANS = [
  "- [~] Read the current page\n- [ ] Write the new copy\n- [ ] Check it on a phone",
  "- [x] Read the current page\n- [~] Write the new copy\n- [ ] Check it on a phone",
];
const llm = scriptedLlm(async (req, { said, afterTool }) => {
  const turn = req.messages.findLastIndex((m) => m.role === "user");
  const inTurn = req.messages.slice(turn).filter((m) => m.role === "tool").length;
  if (said.includes("Rewrite the landing page")) {
    if (!afterTool) return callTool("p1", "plan", { steps: PLANS[0] });
    if (inTurn === 1) return callTool("p2", "plan", { steps: PLANS[1] });
    return say("Copy written; checking it on a phone is next.");
  }
  if (said.includes("not a checklist")) {
    if (!afterTool) return callTool("p3", "plan", { steps: "First read it, then write it." });
    return say(`told: ${String(req.messages.at(-1)?.content)}`);
  }
  if (said.includes("Recount the stock")) {
    if (!afterTool) return callTool("p4", "plan", { steps: "- [x] Count shelf A\n- [~] Count shelf B" });
    return say("Counting.");
  }
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo: TempDir;
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = tempDir("apx-chat-plan-");
  fs.writeFileSync(path.join(repo.path, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo.path })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

const plansIn = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.filter((p): p is Extract<Part, { type: "plan" }> => p.type === "plan"));

test("a plan written and updated in a loose chat is one live checklist under the answer, read again next turn", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: chat.id, text: "Rewrite the landing page copy" });
  await env.settle(chat.id);
  const { messages } = await env.client.call("threads.get", { thread: chat.id });
  const plans = plansIn(messages);
  assert.equal(plans.length, 1, "one plan part, updated in place");
  assert.deepEqual(plans[0]?.steps, planSteps(PLANS[1]));

  // The next turn reads the plan it left, though a summary may drop the call that wrote it.
  await env.client.call("threads.send", { thread: chat.id, text: "how is it going?" });
  await env.settle(chat.id);
  const input = String(llm.calls.at(-1)?.messages.findLast((m) => m.role === "user")?.content);
  assert.match(input, /\[your plan in this chat\][\s\S]*- \[x\] Read the current page\n- \[~\] Write the new copy/);
  assert.doesNotMatch(input, /trust="untrusted"/, "the agent's own plan is not outside content");
});

test("a plan that is not a checklist is refused with how to write it", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: chat.id, text: "plan it, not a checklist" });
  await env.settle(chat.id);
  const { messages } = await env.client.call("threads.get", { thread: chat.id });
  assert.equal(plansIn(messages).length, 0);
  assert.match(JSON.stringify(messages), /one line per step/);
});

test("in a task's chat the plan is the task's plan too: the drawer and the progress guard read it", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Stock count",
    project,
    assignee: "vera",
    goal: "Every shelf counted",
    description: "Recount the stock on shelves A and B",
  });
  await waitFor(() => env.core.store.threads.byTask(t.id).length > 0, "the task's chat");
  const chat = env.core.store.threads.byTask(t.id)[0];
  assert.ok(chat);
  await waitFor(async () => Boolean((await env.client.call("tasks.get", { task: t.id })).task.plan), "the plan");
  await env.settle(chat.id);
  const task = (await env.client.call("tasks.get", { task: t.id })).task;
  assert.deepEqual(planSteps(task.plan), [
    { step: "Count shelf A", state: "done" },
    { step: "Count shelf B", state: "doing" },
  ]);
  const { messages } = await env.client.call("threads.get", { thread: chat.id });
  assert.deepEqual(plansIn(messages)[0]?.steps, planSteps(task.plan));
});
