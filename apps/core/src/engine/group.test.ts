// Group chats (engine/group.ts): the group keeps only the owner's words and the answers, each member works in its own
// chat, a member never reads a teammate's tool steps, and who answers comes from an @mention or the router.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { LlmRequest } from "../providers/llm.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const TOOL_OUTPUT = "LOOKUP-ROWS: forty lines of raw pricing pages nobody else needs";
/** While set, the lookup waits for it: a member still at work. */
let gate: Promise<void> | undefined;

const lookup = defineTool({
  name: "lookup",
  description: "test tool",
  args: z.object({ about: z.string() }),
  effect: "none",
  deadlineMs: 5_000,
  title: () => "Lookup",
  run: async () => {
    await gate;
    return TOOL_OUTPUT;
  },
});

const ROUTER = "You pick who answers";
const lastUser = (r: LlmRequest) => String(r.messages.findLast((m) => m.role === "user")?.content ?? "");
const system = (r: LlmRequest) => String(r.messages[0]?.content ?? "");

async function group(o: { router: string[]; maraFails?: boolean; maraSays?: string }) {
  const ids: Record<string, string> = {};
  const llm = scriptedLlm((_req, ctx) => {
    if (ctx.system.startsWith(ROUTER)) return say(JSON.stringify({ speakers: o.router.map((n) => ids[n]) }));
    if (ctx.system.startsWith("You are Theo"))
      return ctx.afterTool ? say("Hosting is 1,240 USD a month.") : callTool("c1", "lookup", { about: "hosting" });
    if (ctx.system.startsWith("You are Mara")) {
      if (o.maraFails) throw new Error("the model is down");
      return say(o.maraSays ?? "Price it at 6 USD a month.");
    }
    return say("Noted.");
  });
  const env = await startCore({ llm, aux: true, extraTools: [lookup] });
  for (const name of ["Theo", "Mara"])
    ids[name] = (await env.client.call("agents.create", { slug: name.toLowerCase(), name })).id;
  const chat = await env.client.call("threads.group", { agent_ids: ["superagent", ids.Theo ?? "", ids.Mara ?? ""] });
  const said = async (n: number) =>
    waitFor(async () => {
      const got = await env.client.call("threads.get", { thread: chat.id });
      return got.messages.length >= n && got.messages;
    }, `${n} messages in the group`);
  return { env, llm, ids, chat, said };
}

test("the router's pick answers in turn; the second reads the first's answer, never its tool steps", async () => {
  const { env, llm, ids, chat, said } = await group({ router: ["Theo", "Mara"] });
  try {
    await env.client.call("threads.send", { thread: chat.id, text: "What do hosting and the price look like?" });
    const messages = await said(3);
    assert.deepEqual(
      messages.map((m) => (m.author.kind === "agent" ? m.author.id : m.author.kind)),
      ["user", ids.Theo, ids.Mara],
    );
    const theo = llm.calls.filter((r) => system(r).startsWith("You are Theo"));
    assert.ok(
      theo.some((r) => JSON.stringify(r.messages).includes(TOOL_OUTPUT)),
      "Theo reads its own tool output",
    );
    const mara = llm.calls.filter((r) => system(r).startsWith("You are Mara"));
    assert.equal(mara.length, 1);
    const input = lastUser(mara[0] as LlmRequest);
    assert.match(input, /What do hosting and the price look like\?/);
    assert.match(input, /<agent_message from="Theo" trust="team">\nHosting is 1,240 USD a month\./);
    assert.ok(!JSON.stringify(mara[0]?.messages).includes(TOOL_OUTPUT), "Mara never reads Theo's tool steps");
    const first = env.core.store.agents.get("superagent")?.name ?? "";
    assert.ok(
      first && !llm.calls.some((r) => system(r).startsWith(`You are ${first}`)),
      "the first member was not asked",
    );
    // Each member works in a closed chat of its own under the group.
    const sessions = env.core.store.threads.sessions(chat.id);
    assert.deepEqual(sessions.map((t) => t.agent_ids[0]).sort(), [ids.Mara, ids.Theo].sort());
    assert.ok(sessions.every((t) => t.kind === "a2a" && t.parent_id === chat.id));
  } finally {
    await env.core.close();
  }
});

test("an @mention answers without the router, and a member's next turn brings only what is new", async () => {
  const { env, llm, ids, chat, said } = await group({ router: ["Theo"] });
  try {
    await env.client.call("threads.send", { thread: chat.id, text: "How much is hosting?" });
    await said(2);
    const routed = llm.calls.filter((r) => system(r).startsWith(ROUTER)).length;
    await env.client.call("threads.send", { thread: chat.id, text: "@mara what should we charge?" });
    await said(4);
    assert.equal(llm.calls.filter((r) => system(r).startsWith(ROUTER)).length, routed, "no router call");
    await env.client.call("threads.send", { thread: chat.id, text: "@theo and the region?" });
    const messages = await said(6);
    const last = messages.at(-1)?.author;
    assert.equal(last?.kind === "agent" ? last.id : last?.kind, ids.Theo);
    // Theo's second turn: Mara's exchange it missed, then the new question; not its own first question again.
    const second = lastUser(llm.calls.filter((r) => system(r).startsWith("You are Theo")).at(-2) as LlmRequest);
    assert.match(second, /Owner: @mara what should we charge\?/);
    assert.match(second, /<agent_message from="Mara" trust="team">\nPrice it at 6 USD a month\./);
    assert.ok(second.trimEnd().endsWith("@theo and the region?"));
    assert.ok(!second.includes("How much is hosting?"));
  } finally {
    await env.core.close();
  }
});

test("words the owner writes while a member works reach its next turn", async () => {
  const { env, llm, ids, chat, said } = await group({ router: ["Theo"] });
  let open = () => {};
  gate = new Promise((resolve) => {
    open = resolve;
  });
  try {
    await env.client.call("threads.send", { thread: chat.id, text: "@theo how much is hosting?" });
    await waitFor(() => llm.calls.some((r) => system(r).startsWith("You are Theo")), "Theo at work");
    const queued = await env.client.call("threads.send", { thread: chat.id, text: "@theo and the region?" });
    assert.equal(queued.run.agent_id, ids.Theo, "the turn answering now");
    open();
    const messages = await said(4);
    assert.deepEqual(
      messages.map((m) => m.author.kind),
      ["user", "user", "agent", "agent"],
    );
    const turns = llm.calls.filter(
      (r) => system(r).startsWith("You are Theo") && !String(r.messages.at(-1)?.role).includes("tool"),
    );
    const second = lastUser(turns.at(-1) as LlmRequest);
    assert.ok(second.trimEnd().endsWith("@theo and the region?"), second);
  } finally {
    gate = undefined;
    await env.core.close();
  }
});

test("a member whose turn fails leaves a note, and the next in line still answers", async () => {
  const { env, ids, chat, said } = await group({ router: ["Mara", "Theo"], maraFails: true });
  try {
    await env.client.call("threads.send", { thread: chat.id, text: "Price and hosting?" });
    const messages = await said(3);
    const text = (m: (typeof messages)[number]) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    assert.equal(messages[1]?.author.kind, "system");
    assert.match(text(messages[1] as (typeof messages)[number]), /Mara could not answer/);
    const last = messages[2]?.author;
    assert.equal(last?.kind === "agent" ? last.id : last?.kind, ids.Theo);
  } finally {
    await env.core.close();
  }
});

test("a teammate an answer @mentions answers next, once per owner message", async () => {
  const { env, llm, ids, chat, said } = await group({ router: ["Mara"], maraSays: "@theo what does hosting cost?" });
  try {
    await env.client.call("threads.send", { thread: chat.id, text: "What should we charge?" });
    const messages = await said(3);
    assert.deepEqual(
      messages.map((m) => (m.author.kind === "agent" ? m.author.id : m.author.kind)),
      ["user", ids.Mara, ids.Theo],
    );
    const theo = lastUser(llm.calls.find((r) => system(r).startsWith("You are Theo")) as LlmRequest);
    assert.match(theo, /<agent_message from="Mara" trust="team">\n@theo what does hosting cost\?/);
    await waitFor(
      async () => (await env.client.call("threads.get", { thread: chat.id })).thread.state === "completed",
      "the group at rest",
    );
    // Theo's answer names nobody, and Mara is not called in twice for the same owner message.
    const got = await env.client.call("threads.get", { thread: chat.id });
    assert.equal(got.messages.length, 3);
    assert.equal(llm.calls.filter((r) => system(r).startsWith("You are Mara")).length, 1);
  } finally {
    await env.core.close();
  }
});

test("the group shows it is at work while a member answers, and Stop ends the line", async () => {
  const { env, chat } = await group({ router: ["Theo", "Mara"] });
  let open = () => {};
  gate = new Promise((resolve) => {
    open = resolve;
  });
  try {
    await env.client.call("threads.send", { thread: chat.id, text: "Hosting and price?" });
    await waitFor(
      async () => (await env.client.call("threads.get", { thread: chat.id })).thread.state === "working",
      "the group at work",
    );
    await env.client.call("threads.cancel", { thread: chat.id });
    open();
    await waitFor(
      async () => (await env.client.call("threads.get", { thread: chat.id })).thread.state !== "working",
      "the group stopped",
    );
    const got = await env.client.call("threads.get", { thread: chat.id });
    // Theo was stopped and Mara, next in line, never started.
    assert.deepEqual(
      got.messages.map((m) => m.author.kind),
      ["user"],
    );
    assert.ok(env.core.store.threads.sessions(chat.id).every((t) => t.agent_ids[0] !== chat.agent_ids[2]));
  } finally {
    gate = undefined;
    await env.core.close();
  }
});
