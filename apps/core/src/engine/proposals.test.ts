// Agents hand work on through tasks without passing it to and fro: past a few hand-offs, or giving work back up its own
// chain, a new task is a proposal for the owner instead of starting.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { proposalReason } from "./task-work.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

/** The task the scripted agent hands to `handTo` when asked to pass it on. */
let handing = { task: "", to: "" };
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({
    llm: scriptedLlm((_req, { said, afterTool }) =>
      said.includes("pass it on") && !afterTool
        ? callTool("h1", "task_update", { task: handing.task, assignee: handing.to })
        : say("ok"),
    ),
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

function task(title: string, by: string, parent?: string) {
  const store = env.core.store;
  return store.tasks.create({
    title,
    status: "todo",
    parent_id: parent,
    thread_id: store.threads.create({ kind: "task", title, agent_ids: ["superagent"] }).id,
    by,
  });
}

test("a short chain hands on freely; too deep, or back up the chain, waits for the owner", () => {
  const store = env.core.store;
  const audit = task("SEO audit", "owner");
  assert.equal(proposalReason(store, audit.id, "vera", "scout"), undefined, "the audit's findings go to marketing");
  const copy = task("Rewrite the landing copy", "scout", audit.id);
  assert.match(proposalReason(store, copy.id, "scout", "vera") ?? "", /gives work back up its own chain/);
  const check = task("Check the new copy", "vera", copy.id);
  assert.match(proposalReason(store, check.id, "omar", "nora") ?? "", /4 hand-offs deep/);
  assert.equal(proposalReason(store, copy.id, "vera", "vera"), undefined, "its own next step is not a hand-off back");
});

test("handing a task to another agent follows the same rule: back up its chain, it waits for the owner", async () => {
  const store = env.core.store;
  const launch = task("Plan the launch", "superagent");
  const sub = store.tasks.create({
    title: "Draft the launch post",
    description: "Two paragraphs for the blog.",
    status: "todo",
    parent_id: launch.id,
    assignee: "vera",
    thread_id: store.threads.create({ kind: "task", title: "Draft the launch post", agent_ids: ["vera"] }).id,
    by: "superagent",
  });
  handing = { task: sub.id, to: "superagent" };
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "vera", title: "Vera" });
  await env.client.call("threads.send", { thread: chat.id, text: "pass it on" });
  await env.settle(chat.id);
  const after = store.tasks.get(sub.id);
  assert.equal(after?.assignee, "superagent");
  assert.equal(after?.proposed, true, "the owner decides before it goes back up");
  assert.deepEqual(store.threads.byTask(sub.id), [], "no work started on it");
  const step = store.runs
    .list(chat.id, 5)
    .flatMap((r) => store.runs.steps(r.id))
    .find((x) => x.tool === "task_update");
  assert.match(step?.result ?? "", /^proposed /, "the agent is told it waits for the owner");
  const tray = await env.client.call("notifications.list", {});
  assert.ok(
    tray.notifications.some((n) => n.ref?.startsWith("proposals:")),
    "the owner is told of the proposal",
  );
});
