// One wide request to the super-agent does not become a task per agent at once: before it gives work to a third
// agent in a turn, the owner chooses whether it goes on or looks first and proposes a plan.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
  env.cleanup();
});

const until = async (check: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

async function spread(agent = "roby") {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
  await env.client.call("threads.send", { thread: t.id, text: "spread the php review" });
  return t.id;
}
const tasksFor = (who: string) =>
  env.core.store.tasks.list({ state: "open", limit: 500 }).filter((t) => t.assignee === who);

test("the super-agent asks before giving work to a third agent, and looks first when the owner says no", async () => {
  const before = tasksFor("nora").length;
  const thread = await spread();
  await until(() => env.core.store.inputs.pending(thread).length === 1, "the owner was asked");
  const [asked] = env.core.store.inputs.pending(thread);
  assert.match(asked?.prompt ?? "", /quiere repartir trabajo entre varios agentes/);
  assert.match(asked?.prompt ?? "", /Nora/);
  await env.client.call("runs.respond", { input: asked?.id ?? "", decision: "deny" });
  await env.settle(thread);
  assert.equal(tasksFor("nora").length, before, "the third hand-off did not run");
  const reply = llm.calls.flatMap((c) => c.messages).find((m) => m.role === "tool" && m.tool_call_id === "t2");
  assert.match(String(reply?.content), /Survey it in one pass/);
});

test("approved once, the turn goes on handing work out", async () => {
  const before = tasksFor("nora").length;
  const thread = await spread();
  await until(() => env.core.store.inputs.pending(thread).length === 1, "the owner was asked");
  await env.client.call("runs.respond", {
    input: env.core.store.inputs.pending(thread)[0]?.id ?? "",
    decision: "approve",
  });
  await env.settle(thread);
  assert.equal(tasksFor("nora").length, before + 1);
});

test("with the setting off, or for a team's own agent, nothing is asked", async () => {
  await env.client.call("agents.set_fan_out_ask", { ask: false });
  const before = tasksFor("nora").length;
  const off = await spread();
  await env.settle(off);
  assert.equal(env.core.store.inputs.pending(off).length, 0);
  assert.equal(tasksFor("nora").length, before + 1);
  assert.equal((await env.client.call("agents.limits", {})).fan_out_ask, false);

  await env.client.call("agents.set_fan_out_ask", { ask: true });
  const team = await spread("vera");
  await env.settle(team);
  // Vera gives work to scout, nora and omar (three others): a team's agent splits its own work without asking.
  assert.equal(env.core.store.inputs.pending(team).length, 0, "only the super-agent asks");
  assert.ok(tasksFor("omar").length >= 2);
});
