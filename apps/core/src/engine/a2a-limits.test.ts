// A delegated run works while it makes progress, stops at its cap, and when a limit cuts it short it is not lost:
// APX goes on in the same session while each part progresses, the owner hears when it stops, and the caller can stop it.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, type TestContext, test } from "node:test";
import type { Part } from "@apx/protocol";
import type { ApxSocket } from "@apx/protocol/client";
import { z } from "zod";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Wide enough that a loaded CI runner's pauses between steps never look like a stall: a Windows runner once took
// longer than 800 ms over a 200 ms step. The cap stays six idle windows.
const IDLE_MS = 1500;
const CAP_MS = 9000;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** One step of a long job: a quarter of the idle window. */
const slowStep = defineTool({
  name: "slow_step",
  description: "test tool",
  args: z.object({ n: z.number() }),
  effect: "none",
  deadlineMs: 5_000,
  title: () => "Slow step",
  run: async (_a, ctx) => {
    await sleep(IDLE_MS / 4, ctx.signal);
    return "step done";
  },
});

/** One step of a build: it changes something, a different thing each time. */
const buildStep = defineTool({
  name: "build_step",
  description: "test tool",
  args: z.object({ n: z.number() }),
  effect: "local",
  deadlineMs: 5_000,
  title: () => "Build step",
  run: async (_a, ctx) => {
    await sleep(IDLE_MS / 4, ctx.signal);
    return "built";
  },
});
const worker = (name: string) => ({ name, instructions: `${name} works on it.` });
const CONTINUED = "APX stopped your last turn on this task";

const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  const steps = req.messages.filter((m) => m.role === "tool").length;
  const step = () => callTool(`s${req.messages.length}`, "slow_step", { n: steps });
  // Eight steps: two idle windows of steady progress.
  if (system.startsWith("You are Steady")) return steps < 8 ? step() : say("Steady finished.");
  // Never stops making progress: only the cap ends it.
  if (system.startsWith("You are Endless") || system.startsWith("You are Forever")) return step();
  // Builds something new at every step and finishes in its third part: progress APX keeps going on with.
  if (system.startsWith("You are Builder")) {
    const parts = req.messages.filter((m) => m.role === "user" && String(m.content).includes(CONTINUED)).length;
    return parts >= 2 ? say("Builder finished.") : callTool(`b${req.messages.length}`, "build_step", { n: steps });
  }
  // Goes quiet on every turn, the continuation too.
  if (system.startsWith("You are Quiet")) {
    await sleep(IDLE_MS * 4, req.signal);
    return say("late");
  }
  // Goes quiet once, then finishes what is left when APX continues it.
  if (system.startsWith("You are Napper")) {
    if (said.includes(CONTINUED)) return say("Napper finished the rest.");
    if (!afterTool) return callTool("n1", "slow_step", { n: 0 });
    await sleep(IDLE_MS * 4, req.signal);
    return say("late");
  }
  // A command longer than the idle window, silent while it runs.
  if (system.startsWith("You are Renderer"))
    return afterTool ? say("Rendered.") : callTool("r1", "shell", { command: "sleep 1 && echo rendered" });
  if (said.includes("<delegation_result")) return say("The delegate is back.");
  if (afterTool) return say("Done.");
  const ask = said.match(/^delegate (\w+)( inline)?$/);
  if (ask?.[1]) {
    const name = ask[1][0]?.toUpperCase() + ask[1].slice(1);
    return callTool("d1", "delegate", { worker: worker(name), task: `${name} task`, wait_s: ask[2] ? 10 : 0 });
  }
  if (said === "stop forever") return callTool("x1", "stop_session", { session: "forever" });
  return say("Hello.");
});

let env: Awaited<ReturnType<typeof startCore>>;
let operator: ApxSocket;
before(async () => {
  env = await startCore({ llm, extraTools: [slowStep, buildStep], turnIdleMs: IDLE_MS, a2aCapMs: CAP_MS });
});
beforeEach(async () => {
  operator = await env.client.connect("operator");
});
afterEach(() => operator?.close());
after(async () => {
  await env.core.close();
  env.cleanup();
});

/** Long enough for two capped parts and the caller's wake-up, whatever the windows above. */
async function until<T>(get: () => T | undefined | false, what: string, ms = CAP_MS * 4): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = get();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
}

/** The owner's chat with the caller, after it delegated: the chat and the session it opened. */
async function delegated(text: string) {
  const t = await operator.call("threads.create", { kind: "loose", agent_id: "roby", title: text });
  await operator.call("threads.send", { thread: t.id, text });
  const sub = await until(() => env.core.store.threads.sessions(t.id)[0], "the session");
  return { thread: t.id, sub: sub.id };
}
/** Oldest first. */
const runsOf = (threadId: string) => env.core.store.runs.list(threadId, 20).reverse();
const ended = (threadId: string, n: number) =>
  until(() => {
    const runs = runsOf(threadId);
    return runs.length >= n && runs.every((r) => r.ended_at) && runs;
  }, `${n} ended runs in ${threadId}`);
const woke = (threadId: string) =>
  until(
    () => env.core.store.runs.list(threadId).find((r) => r.input?.origin.kind === "delegation_result" && r.ended_at),
    "the caller woken with the result",
  );
const notices = (threadId: string) =>
  env.core.store.messages
    .list(threadId)
    .flatMap((m) => m.parts)
    .filter((p): p is Extract<Part, { type: "notice" }> => p.type === "notice" && p.code === "delegation.limit");
const card = (threadId: string) =>
  env.core.store.messages
    .list(threadId)
    .flatMap((m) => m.parts)
    .find((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");

test("a delegated run that keeps making progress works past its idle window", async () => {
  const { sub } = await delegated("delegate steady");
  const [run] = await ended(sub, 1);
  assert.equal(run?.state, "completed");
  assert.equal(run?.end_reason, "normal");
  assert.ok(Date.parse(run?.ended_at ?? "") - Date.parse(run?.started_at ?? "") > IDLE_MS, "longer than one window");
});

test("a caller waiting on a delegate at work is held too, past its own idle window", async () => {
  const t = await operator.call("threads.create", { kind: "loose", agent_id: "roby", title: "inline steady" });
  await operator.call("threads.send", { thread: t.id, text: "delegate steady inline" });
  const runs = await ended(t.id, 1);
  assert.equal(runs[0]?.state, "completed", runs[0]?.error);
  assert.equal(runs[0]?.end_reason, "normal");
  const reply = llm.calls.flatMap((c) => c.messages).findLast((m) => m.role === "tool" && m.tool_call_id === "d1");
  assert.match(String(reply?.content), /Steady finished/);
});

test("a command running longer than the idle window counts as progress", async () => {
  const { sub } = await delegated("delegate renderer");
  const [run] = await ended(sub, 1);
  assert.equal(run?.state, "completed", run?.error);
  assert.equal(run?.end_reason, "normal");
});

test("a delegated run that never stops is ended at its cap, however much progress it makes", async () => {
  const { thread, sub } = await delegated("delegate endless");
  const runs = await ended(sub, 2);
  const [first, second] = runs;
  assert.equal(first?.end_reason, "deadline");
  assert.match(first?.error ?? "", /a delegated run may work/);
  // APX went on once in the same session; that part only looked things up again, so APX stopped there.
  assert.equal(second?.input?.continues, first?.id);
  assert.equal(second?.end_reason, "deadline");
  const result = await woke(thread);
  const origin = result.input?.origin;
  assert.equal(origin?.kind === "delegation_result" && origin.stopped, "it only looked things up and changed nothing");
  assert.equal(runsOf(sub).length, 2);
  assert.deepEqual(
    notices(thread).map((n) => n.vars?.variant),
    ["continuedTime", "stoppedTime"],
  );
});

test("a run cut short goes on once in the same session, with its context, and reports to the same caller", async () => {
  const { thread, sub } = await delegated("delegate napper");
  const [first, second] = await ended(sub, 2);
  assert.equal(first?.state, "failed");
  assert.equal(first?.end_reason, "deadline");
  assert.match(first?.error ?? "", /made no progress/);
  assert.equal(second?.state, "completed");
  assert.equal(second?.input?.continues, first?.id);
  assert.equal(second?.parent_run_id, first?.parent_run_id);
  // The continuation is the same agent in the same session: it still sees the task and what it did.
  const seen = llm.calls.findLast(
    (c) =>
      String(c.messages[0]?.content).startsWith("You are Napper") &&
      c.messages.some((m) => m.role === "user" && String(m.content).includes(CONTINUED)),
  );
  const history = JSON.stringify(seen?.messages ?? []);
  assert.match(history, /Napper task/);
  assert.match(history, /step done/);
  const result = await woke(thread);
  assert.equal(result.input?.origin.kind === "delegation_result" && result.input.origin.state, "completed");
  assert.equal(card(thread)?.state, "completed");
  // The chat says it hit its limit and APX went on with it; going on is APX's own business, so nothing reaches the tray.
  const [notice] = notices(thread);
  assert.equal(notice?.vars?.variant, "continuedTime");
  assert.equal(notice?.level, "info");
  assert.equal(notice?.vars?.who, "Napper");
  assert.equal(notice?.vars?.subthread, sub);
  const tray = env.core.store.notifications.list({ unreadOnly: true, limit: 50 }).find((n) => n.ref === sub);
  assert.equal(tray, undefined);
});

test("a delegate that keeps making progress goes on part after part, with no one asked", async () => {
  const { thread, sub } = await delegated("delegate builder");
  const [first, second, third] = await ended(sub, 3);
  assert.equal(first?.end_reason, "deadline");
  assert.equal(second?.input?.continues, first?.id);
  assert.equal(third?.input?.continues, second?.id);
  assert.equal(third?.state, "completed");
  assert.equal(third?.end_reason, "normal");
  const result = await woke(thread);
  assert.equal(result.input?.origin.kind === "delegation_result" && result.input.origin.state, "completed");
  assert.deepEqual(
    notices(thread).map((n) => n.vars?.variant),
    ["continuedTime", "continuedTime"],
  );
  assert.equal(
    env.core.store.notifications.list({ unreadOnly: true, limit: 50 }).filter((n) => n.ref === sub).length,
    0,
  );
});

test("a part that made no progress stops: the caller tells the owner, who gets Continue on the notice", async () => {
  const { thread, sub } = await delegated("delegate quiet");
  const [first, second] = await ended(sub, 2);
  assert.equal(second?.input?.continues, first?.id);
  const result = await woke(thread);
  const origin = result.input?.origin;
  assert.equal(origin?.kind, "delegation_result");
  if (origin?.kind !== "delegation_result") return;
  assert.equal(origin.end_reason, "deadline");
  assert.equal(origin.session, "quiet");
  assert.equal(origin.stopped, "none of its calls worked");
  // A third run never starts on its own: the owner decides.
  assert.equal(runsOf(sub).length, 2);
  const framed = llm.calls
    .flatMap((c) => c.messages)
    .find((m) => m.role === "user" && String(m.content).includes(`sub_thread="${sub}`));
  const text = String(framed?.content);
  assert.match(text, /state="out_of_time"/);
  assert.match(text, /ran out of time before finishing: this is a progress report, not its final result/);
  assert.match(text, /APX stopped going on with it on its own: none of its calls worked/);
  assert.match(text, /Continue on its notice in APX/);
  assert.doesNotMatch(text, /delegate only the rest/);
  assert.deepEqual(
    notices(thread).map((n) => n.vars?.variant),
    ["continuedTime", "stoppedTime"],
  );
  const tray = env.core.store.notifications.list({ unreadOnly: true, limit: 50 }).find((n) => n.ref === sub);
  assert.match(tray?.body ?? "", /Quiet ran out of time .* made no progress/);
  assert.equal(card(thread)?.end_reason, "deadline");
});

test("a caller still waiting gets the progress report itself, and APX neither goes on nor adds a notice", async () => {
  const t = await operator.call("threads.create", { kind: "loose", agent_id: "roby", title: "inline" });
  await operator.call("threads.send", { thread: t.id, text: "delegate quiet inline" });
  await ended(t.id, 1);
  const sub = env.core.store.threads.sessions(t.id)[0]?.id ?? "";
  assert.equal(runsOf(sub).length, 1);
  const reply = String(
    llm.calls.flatMap((c) => c.messages).findLast((m) => m.role === "tool" && String(m.content).includes("Quiet"))
      ?.content,
  );
  assert.match(reply, /state="out_of_time"/);
  assert.match(reply, /delegate only the rest with session="quiet"/);
  assert.doesNotMatch(reply, /APX stopped going on/);
  // The owner reads it in the answer being written, with the card: no separate notice.
  assert.equal(notices(t.id).length, 0);
  assert.equal(card(t.id)?.end_reason, "deadline");
});

test("the caller can stop a session it started, and the tool is offered only while one works", async () => {
  const { thread, sub } = await delegated("delegate forever");
  await until(() => runsOf(sub)[0]?.state === "working", "the session at work");
  const offered = (said: string) =>
    JSON.stringify(
      llm.calls.findLast((c) =>
        c.messages.some((m) => m.role === "user" && String(m.content).endsWith(said) && c.tools.length),
      )?.tools,
    );
  assert.doesNotMatch(offered("delegate forever"), /stop_session/);
  await operator.call("threads.send", { thread, text: "stop forever" });
  const [run] = await ended(sub, 1);
  assert.equal(run?.state, "canceled");
  assert.match(offered("stop forever"), /stop_session/);
  // Stopped by its caller: nobody is woken and APX does not go on with it.
  await new Promise((r) => setTimeout(r, IDLE_MS));
  assert.equal(runsOf(sub).length, 1);
  assert.equal(card(thread)?.state, "canceled");
});

test("the owner hears of the limit on the channel their chat lives on, in their language", async (t: TestContext) => {
  const TOKEN = "123456:TEST-limits";
  const OWNER = 1001;
  const tg = await fakeTelegram(TOKEN);
  const own = await startCore({
    llm,
    extraTools: [slowStep],
    turnIdleMs: IDLE_MS,
    a2aCapMs: CAP_MS,
    channelAdapters: {
      telegram: (c: Parameters<typeof telegramAdapter>[0], token: string | undefined) =>
        telegramAdapter(c, token, tg.url),
    },
  });
  t.after(async () => {
    await own.core.close();
    await tg.close();
    own.cleanup();
  });
  await own.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  own.core.store.persons.link(own.core.store.persons.owner().id, { channel: "tg", external_id: String(OWNER) });
  const chat = await own.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "on telegram" });
  own.core.store.threads.mergeContext(chat.id, { reply_to: { channel: "tg", conversation: String(OWNER) } });
  await own.client.call("threads.send", { thread: chat.id, text: "delegate quiet" });
  const sent = await until(
    () => tg.messagesTo(OWNER).find((m) => String(m.body.text).includes("se quedó sin tiempo")),
    "the notice on Telegram",
    30_000,
  );
  assert.match(String(sent.body.text), /^Quiet se quedó sin tiempo con «Quiet task» y su último tramo no avanzó/);
  // APX going on with it on its own (the first part) is not news for the owner's phone.
  assert.ok(!tg.messagesTo(OWNER).some((m) => String(m.body.text).includes("viene avanzando")));
  // Continue is a button under the notice: pressing it gives the session one more turn, with nothing to write.
  const markup = sent.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  const go = markup?.inline_keyboard.flat().find((b) => b.text === "Continuar");
  assert.ok(go, "a Continue button");
  const sub = own.core.store.threads.sessions(chat.id)[0]?.id ?? "";
  const before = own.core.store.runs.list(sub, 20).length;
  tg.press({ id: OWNER, name: "Owner" }, go.callback_data);
  await until(() => own.core.store.runs.list(sub, 20).length > before, "the session going on after the press");
  const again = own.core.store.runs.list(sub, 1)[0];
  assert.equal(again?.input?.origin.kind, "user");
  await until(
    () => tg.messagesTo(OWNER).some((m) => String(m.body.text).includes("sigue trabajando")),
    "the press answered",
  );
});
