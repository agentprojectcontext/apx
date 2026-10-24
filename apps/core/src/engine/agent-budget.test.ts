// An agent's own budget inside the breaker's: past it that agent waits while the others go on, and the coordinator
// sees what each one has left before it gives out work.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { agentTrip, trip } from "./breaker.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("done");
  if (said.includes("ask scout")) return callTool("s1", "delegate", { agent: "scout", task: "check the invoices" });
  if (said.includes("ask vera")) return callTool("v1", "delegate", { agent: "vera", task: "check the invoices" });
  if (said.includes("who can help")) return callTool("l1", "list_agents", {});
  if (said.includes("give scout a task"))
    return callTool("t1", "task_create", {
      title: "Recount the invoices",
      description: "Verify the invoice totals.",
      assignee: "scout",
    });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const toolResult = (id: string) =>
  String(
    llm.calls
      .flatMap((c) => c.messages)
      .findLast((m) => m.role === "tool" && (m as { tool_call_id?: string }).tool_call_id === id)?.content ??
      llm.calls.at(-1)?.messages.at(-1)?.content,
  );

/** A chat where Scout already worked once on its own, in a sub-thread under Roby's. */
async function chainWithScoutTurn(title: string) {
  const { store } = env.core;
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title });
  const sub = store.threads.create({ kind: "a2a", title: "earlier", agent_ids: ["scout", "roby"], parent_id: t.id });
  const r = store.runs.create({
    thread_id: sub.id,
    agent_id: "scout",
    trigger: "a2a",
    input: { origin: { kind: "user" }, text: "x" },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.runs.setState(r, "completed");
  return t;
}

/** Roby takes an unattended turn (a result waking it) in `thread` with `text`. */
async function robyOnItsOwn(thread: string, text: string) {
  env.core.engine.admit({
    thread_id: thread,
    agent_id: "roby",
    trigger: "a2a_result",
    origin: { kind: "user" },
    text,
  });
  await env.settle(thread);
}

test("the owner gives an agent a budget of its own, takes it back with null, and the chain's limits keep it", async () => {
  await assert.rejects(env.client.call("agents.set_agent_limits", { agent: "nobody", limits: { runs: 1 } }));
  assert.deepEqual(await env.client.call("agents.set_agent_limits", { agent: "scout", limits: { runs: 3 } }), {
    agents: { scout: { runs: 3 } },
  });
  await env.client.call("agents.set_limits", { runs: 10, tokens: 0 });
  const limits = await env.client.call("agents.limits", {});
  assert.deepEqual([limits.runs, limits.agents], [10, { scout: { runs: 3 } }]);
  // 0 in every field is no budget of its own, like null.
  assert.deepEqual(await env.client.call("agents.set_agent_limits", { agent: "scout", limits: { runs: 0 } }), {
    agents: {},
  });
  await env.client.call("agents.set_agent_limits", { agent: "scout", limits: { tokens: 5000 } });
  assert.deepEqual(await env.client.call("agents.set_agent_limits", { agent: "scout", limits: null }), {
    agents: {},
  });
  env.core.store.settings.write("agent_limits", {});
});

test("an agent past its own budget is refused while the chain goes on, and another agent takes the work", async () => {
  const { store } = env.core;
  const t = await chainWithScoutTurn("own budget");
  await env.client.call("agents.set_agent_limits", { agent: "scout", limits: { runs: 1 } });
  try {
    assert.ok(agentTrip(store, t.id, "scout"));
    assert.equal(agentTrip(store, t.id, "vera"), undefined);
    await robyOnItsOwn(t.id, "ask scout");
    assert.match(toolResult("s1"), /refused: Scout started 1 turns on its own since the owner last wrote here/);
    assert.match(toolResult("s1"), /another agent/);
    // Only Scout waits: no pause for the chain, no notice for the owner.
    assert.equal(trip(store, t.id), undefined);
    assert.equal(
      store.messages
        .list(t.id)
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "notice").length,
      0,
    );
    await robyOnItsOwn(t.id, "ask vera");
    assert.equal(store.threads.sessions(t.id).length, 2);
    // The owner writes: a new window for every agent, Scout too.
    await env.client.call("threads.send", { thread: t.id, text: "thanks" });
    await env.settle(t.id);
    assert.equal(agentTrip(store, t.id, "scout"), undefined);
  } finally {
    store.settings.write("agent_limits", {});
  }
});

test("list_agents shows what the chain and each agent with a budget have used since the owner last wrote", async () => {
  const t = await chainWithScoutTurn("budget left");
  await env.client.call("agents.set_limits", { runs: 16, tokens: 0 });
  await env.client.call("agents.set_agent_limits", { agent: "scout", limits: { runs: 4, tokens: 200_000 } });
  try {
    await robyOnItsOwn(t.id, "who can help");
    const listed = toolResult("l1");
    assert.match(listed, /^Agents on their own since the owner last wrote: 2 of 16 turns/);
    assert.match(listed, /- Scout \(id: scout\).* · own budget used: 1 of 4 turns, 0k of 200k tokens/);
    assert.doesNotMatch(listed, /- Vera \(id: vera\).*own budget/);
  } finally {
    env.core.store.settings.write("agent_limits", {});
  }
});

test("a task given to an agent past its own budget waits for the owner, who sees why and lets it start", async () => {
  const { store } = env.core;
  const t = await chainWithScoutTurn("held task");
  await env.client.call("agents.set_agent_limits", { agent: "scout", limits: { runs: 1 } });
  try {
    await robyOnItsOwn(t.id, "give scout a task");
    const held = store.threads.context(t.id).held ?? [];
    assert.equal(held.length, 1);
    const notice = store.messages
      .list(t.id)
      .flatMap((m) => m.parts)
      .find((p) => p.type === "notice" && p.code === "breaker.held");
    assert.deepEqual(notice?.type === "notice" && [notice.vars?.variant, notice.vars?.spent, notice.vars?.who], [
      "agentRuns",
      "1",
      "Scout",
    ]);
    assert.match(notice?.type === "notice" ? notice.text : "", /Scout started 1 turns on its own/);
    assert.deepEqual(await env.client.call("threads.go_on", { thread: t.id, mode: "reset" }), { started: 1 });
    assert.equal(store.threads.context(t.id).held, undefined);
  } finally {
    store.settings.write("agent_limits", {});
  }
});
