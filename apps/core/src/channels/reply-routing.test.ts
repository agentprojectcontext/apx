import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { Llm } from "../providers/llm.ts";
import { defineTool, type Tool } from "../tools/types.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-routing";
const OWNER = { id: 1001, name: "Owner" };
const probe = defineTool({
  name: "routing_probe",
  description: "A probe needing approval",
  args: z.object({}),
  effect: "external",
  confirm: "always",
  deadlineMs: 5000,
  title: () => "Probe",
  run: async () => "probed",
});
const questionLlm = () =>
  scriptedLlm((_req, { said, afterTool }) => {
    if (afterTool) return say("Question sent");
    if (said.includes("ask from project")) return callTool("q1", "ask_owner", { question: "Which color?" });
    return say("Answer received");
  });
const probeLlm = () =>
  scriptedLlm((_req, { said, afterTool }) => {
    if (afterTool) return say("Probe finished");
    if (said.includes("start probe") || said.includes("it will run without asking"))
      return callTool("probe", "routing_probe", {});
    return say("App answer");
  });

async function until(check: () => boolean | Promise<boolean>, what: string) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
}

async function setup(t: TestContext, llm: Llm, extraTools: Tool[] = [probe]) {
  const tg = await fakeTelegram(TOKEN);
  const options = {
    llm,
    extraTools,
    channelAdapters: {
      telegram: (c: Parameters<typeof telegramAdapter>[0], token: string | undefined) =>
        telegramAdapter(c, token, tg.url),
    },
  };
  const f = { tg, options, env: await startCore(options) };
  t.after(async () => {
    await f.env.core.close();
    await tg.close();
    f.env.cleanup();
  });
  // Where answers go when turns wait in line (not the default, where a message joins the running turn).
  await f.env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "roby", concurrency: "queue" },
    token: TOKEN,
  });
  const owner = f.env.core.store.persons.owner();
  f.env.core.store.persons.link(owner.id, { channel: "tg", external_id: String(OWNER.id) });
  return f;
}

test("a free-form Telegram reply resumes the exact delivered question from another thread", async (t) => {
  let beginQuestion = () => {};
  let resumeQuestion = () => {};
  const started = new Promise<void>((resolve) => {
    beginQuestion = resolve;
  });
  const held = new Promise<void>((resolve) => {
    resumeQuestion = resolve;
  });
  const llm = scriptedLlm(async (_req, { said, afterTool }) => {
    if (afterTool) return say("Question sent");
    if (said.includes("ask from project")) {
      beginQuestion();
      await held;
      return callTool("q1", "ask_owner", { question: "Which color?" });
    }
    return say("Answer received");
  });
  const f = await setup(t, llm);
  const project = await f.env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await f.env.client.call("threads.send", { thread: project.id, text: "ask from project" });
  await started;
  const run = f.env.core.store.runs.list(project.id)[0];
  if (!run) throw new Error("project run missing");
  f.env.core.store.runs.setReplyTo(run.id, { channel: "tg", conversation: String(OWNER.id) });
  resumeQuestion();

  await until(() => f.env.core.store.inputs.pending(project.id).length > 0, "project question");
  const question = f.env.core.store.inputs.pending(project.id)[0];
  if (!question) throw new Error("project question missing");
  await until(
    () => f.tg.messagesTo(OWNER.id).some((m) => String(m.body.text).includes("Which color?")),
    "delivered question",
  );

  f.tg.message(OWNER, "Green, please");
  await until(() => f.env.core.store.inputs.get(question.id)?.state !== "pending", "question answered");
  await until(() => f.env.core.store.runs.list(project.id)[0]?.state === "completed", "resumed run");
  assert.equal(f.env.core.store.inputs.get(question.id)?.answer, "Green, please");
  assert.equal(f.env.core.store.runs.list(project.id).length, 1);
  // Only Home talks on the owner's phone: this chat's answer stays in the app.
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!f.tg.messagesTo(OWNER.id).some((m) => String(m.body.text).includes("Answer received")));
  assert.equal(f.env.core.store.threads.context(project.id).reply_to, undefined);

  // What the owner writes next goes to Home, whose agent sees what that chat sent them and where it is.
  const calls = llm.calls.length;
  f.tg.message(OWNER, "what was that color for?");
  await until(() => llm.calls.length > calls, "Home's turn");
  const seen = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(seen, new RegExp(`<sent_to_owner from_chat="${project.id}"[^>]*>\\nWhich color\\?`));
  assert.match(seen, /pass their answer to that chat's agent with delegate/);
});

test("a question something else was sent after is not answered by the owner's next words there", async (t) => {
  const f = await setup(t, questionLlm());
  const project = await f.env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await f.env.client.call("threads.send", { thread: project.id, text: "ask from project" });
  await until(() => f.env.core.store.inputs.pending(project.id).length > 0, "project question");
  const question = f.env.core.store.inputs.pending(project.id)[0];
  if (!question) throw new Error("project question missing");
  const run = f.env.core.store.runs.get(question.run_id);
  if (!run) throw new Error("project run missing");
  f.env.core.store.runs.setReplyTo(run.id, { channel: "tg", conversation: String(OWNER.id) });
  // The question reaches Telegram as it does when the app leaves it unanswered.
  f.env.core.store.channels.outbox.add({
    channel: "tg",
    conversation: String(OWNER.id),
    thread_id: project.id,
    kind: "input",
    body: { text: "Which color?", input_id: question.id },
  });
  await until(
    () => f.tg.messagesTo(OWNER.id).some((m) => String(m.body.text).includes("Which color?")),
    "delivered question",
  );
  await new Promise((r) => setTimeout(r, 5));
  f.env.core.store.channels.outbox.add({
    channel: "tg",
    conversation: String(OWNER.id),
    kind: "notice",
    body: { text: "The weekly report is ready." },
  });
  await until(
    () => f.tg.messagesTo(OWNER.id).some((m) => String(m.body.text).includes("weekly report")),
    "a later message",
  );

  f.tg.message(OWNER, "remind me to call the dentist");
  await until(() => f.env.core.store.runs.list("home").length > 0, "normal Home message");
  assert.equal(f.env.core.store.inputs.get(question.id)?.state, "pending", "the old question is still open");
});

test("a message does not answer a question that was not delivered to that chat", async (t) => {
  const f = await setup(t, questionLlm());
  const project = await f.env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await f.env.client.call("threads.send", { thread: project.id, text: "ask from project" });
  await until(() => f.env.core.store.inputs.pending(project.id).length > 0, "project question");

  f.tg.message(OWNER, "unrelated message");
  await until(() => f.env.core.store.runs.list("home").length > 0, "normal Home message");
  assert.equal(f.env.core.store.inputs.pending(project.id).length, 1);
});

test("approving in the app keeps a Telegram turn on Telegram while an app turn is queued", async (t) => {
  const f = await setup(t, probeLlm());
  f.tg.message(OWNER, "start probe");
  await until(() => f.env.core.store.inputs.pending("home").length > 0, "approval");
  const input = f.env.core.store.inputs.pending("home")[0];
  await f.env.client.call("threads.send", { thread: "home", text: "from app", mode: "queue" });
  await f.env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
  await f.env.settle("home");
  await until(() => f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "Probe finished"), "Telegram result");
  assert.ok(!f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "App answer"));
});

test("an app turn does not leak its answer to a Telegram message queued behind it", async (t) => {
  const f = await setup(t, probeLlm());
  await f.env.client.call("threads.send", { thread: "home", text: "start probe" });
  await until(() => f.env.core.store.inputs.pending("home").length > 0, "approval");
  const input = f.env.core.store.inputs.pending("home")[0];
  f.tg.message(OWNER, "hello");
  await until(() => f.env.core.store.runs.list("home").length === 2, "queued channel turn");
  await f.env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
  await f.env.settle("home");
  await until(() => f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "App answer"), "channel answer");
  assert.ok(!f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "Probe finished"));
});

test("a Telegram approval resumed after restart retains its destination and channel context", async (t) => {
  const llm = probeLlm();
  const f = await setup(t, llm);
  f.tg.message(OWNER, "start probe");
  await until(() => f.env.core.store.inputs.pending("home").length > 0, "approval");
  const input = f.env.core.store.inputs.pending("home")[0];
  const home = f.env.home;
  await f.env.core.close();
  f.env = await startCore({ ...f.options, home });
  await f.env.client.call("threads.send", { thread: "home", text: "from app" });
  await f.env.settle("home");
  await f.env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
  await f.env.settle("home");
  await until(() => f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "Probe finished"), "resumed Telegram answer");
  const resumed = llm.calls.findLast((c) =>
    c.messages.some((m) => String(m.content).includes("it will run without asking")),
  );
  assert.match(String(resumed?.messages.findLast((m) => m.role === "user")?.content), /channel: telegram/);
  assert.equal(f.env.core.store.inputs.pending("home").length, 0);
});

test("a late delegation result returns on its caller's channel after the owner writes in the app", async (t) => {
  let release = () => {};
  const report = new Promise<void>((resolve) => {
    release = resolve;
  });
  const llm = scriptedLlm(async (_req, { system, said, afterTool }) => {
    if (system.startsWith("You are Researcher")) {
      await report;
      return say("Report ready");
    }
    if (said.includes("<delegation_result")) return say("Research complete");
    if (afterTool) return say("Research started");
    if (said.includes("research later"))
      return callTool("delegate", "delegate", {
        worker: { name: "Researcher", instructions: "Return the report." },
        task: "research",
        wait_s: 0,
      });
    return say("App answer");
  });
  t.after(release);
  const f = await setup(t, llm, []);
  f.tg.message(OWNER, "research later");
  await until(() => f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "Research started"), "caller finished");
  await f.env.client.call("threads.send", { thread: "home", text: "from app" });
  await f.env.settle("home");
  release();
  await until(() => f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "Research complete"), "late result");
  assert.ok(!f.tg.messagesTo(OWNER.id).some((m) => m.body.text === "App answer" || m.body.text === "Report ready"));
});
