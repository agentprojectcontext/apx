// Home on two of the owner's chat apps: answers to a message go where it was written, what comes later follows the
// owner, and the owner can move the conversation (DECISIONS.md#d-224). SKIP never reaches a chat.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { Llm } from "../providers/llm.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN_A = "123456:TEST-switch-a";
const TOKEN_B = "123456:TEST-switch-b";
const OWNER = { id: 1001, name: "Owner" };
const AT_A = { channel: "tga", conversation: String(OWNER.id) };
const AT_B = { channel: "tgb", conversation: String(OWNER.id) };

async function setup(t: TestContext, llm: Llm) {
  const a = await fakeTelegram(TOKEN_A);
  const b = await fakeTelegram(TOKEN_B);
  const env = await startCore({
    llm,
    extraTools: [],
    channelAdapters: {
      telegram: (c: Parameters<typeof telegramAdapter>[0], token: string | undefined) =>
        telegramAdapter(c, token, token === TOKEN_B ? b.url : a.url),
    },
  });
  t.after(async () => {
    await env.core.close();
    await a.close();
    await b.close();
    await env.cleanup();
  });
  for (const [id, token] of [
    ["tga", TOKEN_A],
    ["tgb", TOKEN_B],
  ] as const)
    await env.client.call("channels.set", {
      id,
      channel: { type: "telegram", agent_id: "superagent", concurrency: "queue" },
      token,
    });
  const owner = env.core.store.persons.owner();
  env.core.store.persons.link(owner.id, { channel: "tga", external_id: String(OWNER.id) });
  env.core.store.persons.link(owner.id, { channel: "tgb", external_id: String(OWNER.id) });
  const texts = (tg: typeof a) => tg.messagesTo(OWNER.id).map((m) => String(m.body.text));
  return { env, a, b, said: { a: () => texts(a), b: () => texts(b) } };
}

/** A researcher that answers when released; Home moves, sends once or delegates as the owner's words say. */
function homeLlm(onResult: string) {
  let release = () => {};
  const report = new Promise<void>((r) => {
    release = r;
  });
  const llm = scriptedLlm(async (_req, { system, said, afterTool }) => {
    if (system.startsWith("You are Researcher")) {
      await report;
      return say("Report ready");
    }
    if (said.includes("<delegation_result")) return say(onResult);
    const move = /go on in (tga|tgb)/.exec(said)?.[1];
    if (move)
      return afterTool
        ? say("SKIP")
        : callTool("m", "message_contact", { to: "me", channel: move, text: "I'll continue here", stay: true });
    if (said.includes("send the quote to tgb"))
      return afterTool
        ? say("Sent it there")
        : callTool("m", "message_contact", { to: "me", channel: "tgb", text: "The quote" });
    if (said.includes("research later"))
      return afterTool
        ? say("Research started")
        : callTool("d", "delegate", {
            worker: { name: "Researcher", instructions: "Return the report." },
            task: "research",
            wait_s: 0,
          });
    return say(`Answer to: ${said.slice(-40)}`);
  });
  return { llm, release: () => release() };
}

test("the owner moves Home to another chat app: it says so there, and the old one hears nothing more", async (t) => {
  const { llm } = homeLlm("Research complete");
  const f = await setup(t, llm);
  f.a.message(OWNER, "let's go on in tgb");
  await waitFor(() => f.said.b().includes("I'll continue here"), "the line on the new chat", { ms: 6000 });
  await f.env.settle("home");
  assert.deepEqual(f.env.core.store.threads.context("home").reply_to, AT_B);
  assert.deepEqual(f.said.a(), [], "nothing on the old chat, SKIP least of all");

  // Back the same way.
  f.b.message(OWNER, "now go on in tga");
  await waitFor(() => f.said.a().includes("I'll continue here"), "the line back on the first chat", { ms: 6000 });
  await f.env.settle("home");
  assert.deepEqual(f.env.core.store.threads.context("home").reply_to, AT_A);
  assert.ok(!f.said.b().includes("SKIP"));
});

test("a one-off send to another chat app does not move the conversation", async (t) => {
  const { llm } = homeLlm("Research complete");
  const f = await setup(t, llm);
  f.a.message(OWNER, "please send the quote to tgb");
  await waitFor(() => f.said.a().includes("Sent it there"), "the answer where they asked", { ms: 6000 });
  assert.deepEqual(f.said.b(), ["The quote"]);
  assert.deepEqual(f.env.core.store.threads.context("home").reply_to, AT_A);
});

test("a delegated result reaches the chat app the owner moved to, not the one the work started on", async (t) => {
  const { llm, release } = homeLlm("Research complete");
  t.after(release);
  const f = await setup(t, llm);
  f.a.message(OWNER, "research later");
  await waitFor(() => f.said.a().includes("Research started"), "the delegation", { ms: 6000 });
  f.a.message(OWNER, "let's go on in tgb");
  await waitFor(() => f.said.b().includes("I'll continue here"), "the move", { ms: 6000 });
  await f.env.settle("home");
  release();
  await waitFor(() => f.said.b().includes("Research complete"), "the result on the new chat", { ms: 6000 });
  assert.deepEqual(f.said.a(), ["Research started"]);
});

test("a delegated result follows the chat app the owner last wrote on", async (t) => {
  const { llm, release } = homeLlm("Research complete");
  t.after(release);
  const f = await setup(t, llm);
  f.a.message(OWNER, "research later");
  await waitFor(() => f.said.a().includes("Research started"), "the delegation", { ms: 6000 });
  f.b.message(OWNER, "hello from the other app");
  await waitFor(() => f.said.b().some((s) => s.startsWith("Answer to:")), "the answer there", { ms: 6000 });
  await f.env.settle("home");
  release();
  await waitFor(() => f.said.b().includes("Research complete"), "the result where they last wrote", { ms: 6000 });
  assert.deepEqual(f.said.a(), ["Research started"]);
});

test("SKIP for a delegated result is never sent to a chat app", async (t) => {
  const { llm, release } = homeLlm("SKIP");
  t.after(release);
  const f = await setup(t, llm);
  f.a.message(OWNER, "research later");
  await waitFor(() => f.said.a().includes("Research started"), "the delegation", { ms: 6000 });
  release();
  await waitFor(
    () => f.env.core.store.runs.list("home").some((r) => r.trigger === "a2a_result" && r.state === "completed"),
    "the result's turn",
    { ms: 6000 },
  );
  await f.env.settle("home");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(f.said.a(), ["Research started"]);
  const result = f.env.core.store.runs.list("home").find((r) => r.trigger === "a2a_result");
  const kept = result?.message_id ? f.env.core.store.messages.get(result.message_id) : undefined;
  assert.ok(!kept?.parts.some((p) => p.type === "text" && p.text.includes("SKIP")), "no SKIP shown in Home");
});
