// a2a as sessions: a delegation opens a named sub-thread its caller can continue, children work with no more than
// their callers, and agents waking each other without the owner stop at the breaker.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import { inherit } from "../tools/policy.ts";
import { defineTool } from "../tools/types.ts";
import { tripped } from "./breaker.ts";
import { MAX_UNATTENDED_RUNS, MAX_UNATTENDED_TOKENS } from "./limits.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (system.startsWith("You are Scout")) {
    // Scout answers with what it remembers from earlier turns of the same session.
    const earlier = req.messages.filter((m) => m.role === "user").length - 1;
    return say(`Scout here; earlier turns in this session: ${earlier}.`);
  }
  if (afterTool) return say(`Relay: ${String(req.messages.at(-1)?.content).slice(0, 400)}`);
  if (said.includes("start research"))
    return callTool("d1", "delegate", { agent: "scout", session: "market", task: "look at the market" });
  if (said.includes("continue research"))
    return callTool("d2", "delegate", { session: "market", task: "now the competitors" });
  if (said.includes("start named"))
    return callTool("n1", "delegate", { agent: "scout", session: "Market Q3", task: "look" });
  if (said.includes("continue named")) return callTool("n2", "delegate", { session: "Market Q3", task: "more" });
  if (said.includes("research the repo"))
    return callTool("p1", "delegate", { agent: "scout", task: "read the repo", project: "/srv/acme/apps/web" });
  if (said.includes("research elsewhere"))
    return callTool("p2", "delegate", { agent: "scout", task: "read it", project: "Northwind" });
  if (said.includes("ghost session")) return callTool("d3", "delegate", { session: "ghost", task: "anything" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const lastToolResult = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

test("a delegation opens a named session; delegating to the name continues it with the same agent and context", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "sessions" });
  await env.client.call("threads.send", { thread: t.id, text: "start research" });
  await env.settle(t.id);
  assert.match(lastToolResult(), /earlier turns in this session: 0/);
  assert.match(lastToolResult(), /session "market"/);

  await env.client.call("threads.send", { thread: t.id, text: "continue research" });
  await env.settle(t.id);
  assert.match(lastToolResult(), /earlier turns in this session: 1/);

  const subs = env.core.store.threads.sessions(t.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0]?.session, "market");
  assert.equal(subs[0]?.agent_ids[0], "scout");
});

test("continuing a session that does not exist is refused with how to start one", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "ghost" });
  await env.client.call("threads.send", { thread: t.id, text: "ghost session" });
  await env.settle(t.id);
  assert.match(lastToolResult(), /no session "ghost" in this thread; give an agent to start one/);
});

test("a delegated run gets only the tools every caller may use, and the strictest autonomy", () => {
  const tool = (name: string) =>
    defineTool({
      name,
      description: name,
      args: z.object({}),
      effect: "local",
      deadlineMs: 1000,
      title: () => name,
      run: async () => "",
    });
  const tools = [tool("browser_open"), tool("show_widget"), tool("read_output")];
  const base = { role: "", kind: "agent", browser_profile: "shared", source: "local", prompt: "" } as const;
  const child: AgentRecord = { ...base, id: "c", name: "Child", autonomy: "total" };
  const caller: AgentRecord = { ...base, id: "p", name: "Caller", tools: ["browser"], autonomy: "ask" };
  const r = inherit(child, [caller], tools);
  assert.deepEqual(
    r.tools.map((t) => t.name),
    ["browser_open", "read_output"],
  );
  assert.equal(r.agent.autonomy, "ask");
});

test("the breaker stops unattended chains and an owner's message resets it", async () => {
  const { store } = env.core;
  const root = store.threads.create({ kind: "loose", title: "chain", agent_ids: ["roby"] });
  const sub = store.threads.create({ kind: "a2a", title: "sub", agent_ids: ["scout", "roby"], parent_id: root.id });
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const add = async (thread: string, trigger: "a2a" | "a2a_result" | "user") => {
    // Runs are ordered by creation time: keep each one in its own millisecond.
    await new Promise((r) => setTimeout(r, 2));
    const r = store.runs.create({
      thread_id: thread,
      agent_id: thread === sub.id ? "scout" : "roby",
      trigger,
      input: { origin: { kind: "user" }, text: "x" },
      deadline_at: deadline,
    });
    store.runs.setState(r, "completed");
  };
  await add(root.id, "user");
  for (let i = 0; i < MAX_UNATTENDED_RUNS - 1; i++) await add(i % 2 ? root.id : sub.id, i % 2 ? "a2a_result" : "a2a");
  assert.equal(tripped(store, sub.id), undefined);
  await add(sub.id, "a2a");
  assert.match(tripped(store, root.id) ?? "", /turns on their own/);
  assert.match(tripped(store, sub.id) ?? "", /turns on their own/);
  await add(root.id, "user");
  assert.equal(tripped(store, sub.id), undefined);
});

test("the owner sets the breaker's limits, and 0 turns a limit off", async () => {
  const { store } = env.core;
  const root = store.threads.create({ kind: "loose", title: "limits", agent_ids: ["roby"] });
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const add = async (trigger: "a2a" | "user") => {
    await new Promise((r) => setTimeout(r, 2));
    const r = store.runs.create({
      thread_id: root.id,
      agent_id: "roby",
      trigger,
      input: { origin: { kind: "user" }, text: "x" },
      deadline_at: deadline,
    });
    store.runs.setState(r, "completed");
  };
  await add("user");
  await add("a2a");
  await add("a2a");
  assert.equal(tripped(store, root.id), undefined);
  assert.deepEqual(await env.client.call("agents.set_limits", { runs: 2, tokens: 0 }), { runs: 2, tokens: 0 });
  assert.match(tripped(store, root.id) ?? "", /started 2 turns/);
  await env.client.call("agents.set_limits", { runs: 0, tokens: 0 });
  assert.equal(tripped(store, root.id), undefined);
  const { defaults } = await env.client.call("agents.limits", {});
  assert.deepEqual(defaults, { runs: MAX_UNATTENDED_RUNS, tokens: MAX_UNATTENDED_TOKENS });
  store.settings.write("agent_limits", {});
});

test("policy follows the thread: every turn in a sub-thread works under the agents above it", async () => {
  const { callersOf } = await import("./ancestry.ts");
  const { store } = env.core;
  const root = store.threads.create({ kind: "loose", title: "root", agent_ids: ["roby"] });
  const sub = store.threads.create({ kind: "a2a", title: "s", agent_ids: ["scout", "roby"], parent_id: root.id });
  const subsub = store.threads.create({ kind: "a2a", title: "ss", agent_ids: ["vera", "scout"], parent_id: sub.id });
  assert.deepEqual(
    callersOf(store, subsub.id).map((a) => a.id),
    ["scout", "roby"],
  );
  assert.deepEqual(callersOf(store, root.id), []);
});

test("a session named with spaces and capitals is found again by the same name", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "names" });
  await env.client.call("threads.send", { thread: t.id, text: "start named" });
  await env.settle(t.id);
  await env.client.call("threads.send", { thread: t.id, text: "continue named" });
  await env.settle(t.id);
  assert.match(lastToolResult(), /earlier turns in this session: 1/);
  assert.equal(env.core.store.threads.sessions(t.id).length, 1);
});

test("a delegation names its project: the session works in that project's folder, found by a path inside it too", async () => {
  env.core.store.projects.upsert({ id: "p_acme", name: "Acme", path: "/srv/acme" });
  env.core.store.projects.upsert({ id: "p_acme_web", name: "Acme web", path: "/srv/acme/apps" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "repo" });
  await env.client.call("threads.send", { thread: t.id, text: "research the repo" });
  await env.settle(t.id);
  // The deepest project holding the path.
  assert.equal(env.core.store.threads.sessions(t.id)[0]?.project_id, "p_acme_web");

  await env.client.call("threads.send", { thread: t.id, text: "research elsewhere" });
  await env.settle(t.id);
  assert.match(lastToolResult(), /no project "Northwind"\. Projects: .*Acme/);
});
