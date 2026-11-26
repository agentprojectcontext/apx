// An agent's `tools:` list is its focus, not a wall: what it leaves out stays the agent's through tool_search
// (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

/** The list agent templates wrote before widgets and images were in it. */
const STALE = ["files", "shell", "tasks", "memory", "browser", "agents", "mcp", "web_search", "web_read", "read_chat"];

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("done");
  // A contact's chat frames the owner's words, so the words are looked for inside.
  if (said.includes("show a chart"))
    return callTool("w0", "show_widget", { name: "sales", title: "Sales", html: "<p>sales</p>" });
  if (said === "run the widget")
    return callTool("r0", "tool_run", {
      tool: "show_widget",
      args: { name: "sales", title: "Sales", html: "<p>x</p>" },
    });
  if (said === "search my chats")
    return callTool("s0", "tool_run", { tool: "search_chats", args: { query: "quarterly numbers" } });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let analyst = "";
before(async () => {
  env = await startCore({ llm });
  analyst = (await env.client.call("agents.create", { slug: "analyst", name: "Analyst", role: "Data analyst" })).id;
  await env.client.call("agents.update", { agent: analyst, tools: STALE });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an agent whose tools list leaves widgets out still shows one; the list only says what it uses first", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: analyst });
  const sent = await env.client.call("threads.send", { thread: t.id, text: "show a chart" });
  await env.settle(t.id);
  const [step] = env.core.store.runs.steps(sent.run.id);
  assert.equal(step?.tool, "show_widget");
  assert.equal(step?.state, "ok");
  const { surfaces } = await env.client.call("surfaces.list", {});
  assert.ok(surfaces.some((s) => s.name === "sales"));
  const tools = llm.calls.at(-1)?.tools ?? [];
  const names = tools.map((t) => t.function.name);
  assert.ok(!names.includes("show_widget"), "found with tool_search, not sent on every call");
  const search = tools.find((t) => t.function.name === "tool_search")?.function.description ?? "";
  assert.match(search, /\bshow_widget\b/, "tool_search names it");
});

const searchOf = () =>
  llm.calls.at(-1)?.tools.find((t) => t.function.name === "tool_search")?.function.description ?? "";

test("tool_run reaches a tool outside the agent's focus that is not one of APX's rarely used ones", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: analyst });
  const sent = await env.client.call("threads.send", { thread: t.id, text: "search my chats" });
  await env.settle(t.id);
  assert.match(searchOf(), /Your other tools: [^;.]*\bsearch_chats\b/);
  assert.ok(!(llm.calls.at(-1)?.tools ?? []).some((x) => x.function.name === "search_chats"));
  const [step] = env.core.store.runs.steps(sent.run.id);
  assert.equal(step?.tool, "search_chats");
  assert.equal(step?.state, "ok");
});

test("for an outside app, its helpers or a contact, the same agent's list stays a wall", async () => {
  const store = env.core.store;
  const app = store.threads.create({ kind: "loose", title: "App", agent_ids: [analyst] });
  store.threads.mergeContext(app.id, { client: "external" });
  const helper = store.threads.create({ kind: "loose", title: "Helper", agent_ids: [analyst], parent_id: app.id });
  const person = store.persons.create({ name: "Alex Acme", role: "contact" });
  const contact = store.threads.create({
    kind: "loose",
    title: "Contact Alex",
    agent_ids: [analyst],
    channel: { id: "ch_test", conversation: "alex", person_id: person.id },
  });
  for (const chat of [app, helper, contact]) {
    const before = (await env.client.call("surfaces.list", {})).surfaces.length;
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "show a chart" });
    await env.settle(chat.id);
    const names = (llm.calls.at(-1)?.tools ?? []).map((x) => x.function.name);
    assert.ok(!names.includes("show_widget"), chat.title);
    assert.doesNotMatch(searchOf(), /show_widget|search_chats/, chat.title);
    assert.equal(store.runs.steps(sent.run.id).length, 0, chat.title);
    assert.equal(String(llm.calls.at(-1)?.messages.at(-1)?.content), "unknown tool show_widget", chat.title);
    assert.equal((await env.client.call("surfaces.list", {})).surfaces.length, before, chat.title);
  }
  // Nor does tool_run reach what the turn's policy keeps out.
  await env.client.call("threads.send", { thread: app.id, text: "run the widget" });
  await env.settle(app.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /^unknown tool show_widget/);
});
