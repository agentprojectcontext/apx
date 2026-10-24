// One wide request to the super-agent does not become work for every agent at once: tasks handed to a third agent in
// a turn become proposals the owner picks from, and delegating to a third agent asks the owner first.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const TEAM = ["scout", "vera", "nora", "omar"];

const llm = scriptedLlm((req, { said, afterTool }) => {
  const done = req.messages.filter((m) => m.role === "tool").length;
  const last = String(req.messages.at(-1)?.content ?? "");
  if (afterTool && last.includes("look at this yourself")) return say("I will look first.");
  if (said.includes("spread the php review") && done < TEAM.length)
    return callTool(`t${done}`, "task_create", {
      title: `PHP review ${TEAM[done]}`,
      description: "Check the PHP version and its known issues.",
      assignee: TEAM[done],
    });
  if (said.includes("ask everyone") && done < 3)
    return callTool(`d${done}`, "delegate", { agent: TEAM[done], task: "Which PHP version runs there?", wait_s: 0 });
  return say(afterTool ? "All handed out." : "Hello.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  await env.client.call("agents.create", { slug: "nora", name: "Nora" });
  await env.client.call("agents.create", { slug: "omar", name: "Omar" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function say_(agent: string, text: string) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
  await env.client.call("threads.send", { thread: t.id, text });
  return t.id;
}
const tasksFor = (who: string) =>
  env.core.store.tasks.list({ state: "open", limit: 500 }).filter((t) => t.assignee === who);

test("tasks the super-agent hands to a third agent and on become proposals: no card, no work until accepted", async () => {
  const thread = await say_("roby", "spread the php review");
  await env.settle(thread);
  assert.equal(env.core.store.inputs.pending(thread).length, 0, "nothing stops the turn");
  assert.equal(tasksFor("scout")[0]?.proposed, undefined, "the first two start as usual");
  const [nora] = tasksFor("nora");
  const [omar] = tasksFor("omar");
  assert.equal(nora?.proposed, true);
  assert.equal(omar?.proposed, true);
  assert.equal(env.core.store.threads.byTask(nora?.id ?? "").length, 0, "a proposal starts nothing");
  assert.ok(
    env.core.store.notifications.list({ unreadOnly: true, limit: 50 }).some((n) => n.ref === "proposals:roby"),
    "the owner hears there are proposals to decide",
  );
  // Accepted, it starts like any task just given.
  const accepted = await env.client.call("tasks.update", { task: nora?.id ?? "", proposed: false });
  assert.equal(accepted.proposed, undefined);
  await waitFor(() => env.core.store.threads.byTask(nora?.id ?? "").length === 1, "its work started");
});

test("delegating to a third agent in one turn still asks the owner first", async () => {
  const thread = await say_("roby", "ask everyone");
  await waitFor(() => env.core.store.inputs.pending(thread).length === 1, "the owner was asked");
  assert.match(env.core.store.inputs.pending(thread)[0]?.prompt ?? "", /repartir trabajo entre varios agentes/);
  await env.client.call("runs.respond", {
    input: env.core.store.inputs.pending(thread)[0]?.id ?? "",
    decision: "deny",
  });
  await env.settle(thread);
});

test("with the setting off, or for a team's own agent, nothing is proposed nor asked", async () => {
  await env.client.call("agents.set_fan_out_ask", { ask: false });
  const before = tasksFor("omar").length;
  const off = await say_("roby", "spread the php review");
  await env.settle(off);
  const latest = tasksFor("omar").slice(0, tasksFor("omar").length - before);
  assert.ok(latest.every((t) => !t.proposed));
  await env.client.call("agents.set_fan_out_ask", { ask: true });
  const team = await say_("vera", "spread the php review");
  await env.settle(team);
  assert.ok(
    tasksFor("omar").every((t) => t.created_by !== "vera" || !t.proposed),
    "only the super-agent proposes",
  );
});
