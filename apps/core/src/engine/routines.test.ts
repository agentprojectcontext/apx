import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const TOKEN = "123456:TEST-token";
const OWNER_CHAT = 1001;

const llm = scriptedLlm((_req, { said }) => {
  if (said.includes("check the invoices")) return say("Two new invoices from Northwind.");
  if (said.includes("anything new?")) return say("**SKIP**");
  if (said.includes("break now")) throw new Error("quota exceeded");
  return say("ok");
});

// The scheduler's clock: tests move it forward to make routines due.
let clock = new Date(2026, 9, 5, 7, 0);
let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

const runsOf = async (routine: string) => (await env.client.call("routines.runs", { routine })).runs;
const ended = (routine: string, n: number) =>
  waitFor(async () => {
    const runs = await runsOf(routine);
    return runs.length === n && runs.every((r) => r.delivered !== undefined);
  }, `${n} runs ended`);

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    clock: () => clock,
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
  });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  const owner = env.core.store.persons.owner();
  env.core.store.persons.link(owner.id, { channel: "tg", external_id: String(OWNER_CHAT) });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("a daily routine runs at its time once, in its own chat, and the owner hears the answer", async () => {
  const r = await env.client.call("routines.set", {
    name: "Invoices",
    agent: "roby",
    schedule: { kind: "cron", cron: "30 8 * * 1-5" },
    prompt: "check the invoices",
  });
  assert.equal(r.next_run_at, new Date(2026, 9, 5, 8, 30).toISOString());

  env.core.scheduler.tick();
  assert.equal((await runsOf(r.id)).length, 0, "not due yet");

  clock = new Date(2026, 9, 5, 8, 31);
  env.core.scheduler.tick();
  env.core.scheduler.tick();
  await ended(r.id, 1);
  const [run] = await runsOf(r.id);
  assert.equal(run?.delivered, true);
  const { thread } = await env.client.call("threads.get", { thread: run?.thread_id ?? "" });
  assert.equal(thread.kind, "routine");
  assert.equal(thread.routine_id, r.id, "a routine run exposes its stable identity on get");
  const listed = await env.client.call("threads.list", {});
  assert.equal(listed.threads.find((th) => th.id === thread.id)?.routine_id, r.id, "list preserves the same identity");
  assert.equal(thread.archived, undefined, "a run that told something stays in the lists");
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /routine "Invoices" the owner scheduled/);
  await waitFor(() => tg.messagesTo(OWNER_CHAT).some((m) => /Two new invoices/.test(String(m.body.text))), "delivered");

  const again = await env.client.call("routines.list", {});
  assert.equal(again.routines[0]?.next_run_at, new Date(2026, 9, 6, 8, 30).toISOString(), "next is tomorrow");
});

test("nothing to say: the run is kept but the owner is not bothered", async () => {
  const r = await env.client.call("routines.set", {
    name: "Inbox",
    agent: "roby",
    schedule: { kind: "every", minutes: 30 },
    prompt: "anything new?",
  });
  const before = tg.messagesTo(OWNER_CHAT).length;
  clock = new Date(clock.getTime() + 31 * 60_000);
  env.core.scheduler.tick();
  await ended(r.id, 1);
  const [quiet] = await runsOf(r.id);
  assert.equal(quiet?.delivered, false);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(tg.messagesTo(OWNER_CHAT).length - before, 0);
  // Reached from its routine, but out of the chat list and its unread count.
  const { thread } = await env.client.call("threads.get", { thread: quiet?.thread_id ?? "" });
  assert.equal(thread.archived, true);
  assert.equal(thread.unread, 0);
  const { threads } = await env.client.call("threads.list", { include_archived: true });
  assert.ok(!threads.some((t) => t.id === quiet?.thread_id), "a quiet run is not listed");
});

test("run now, a failed run is reported, and bad schedules are refused", async () => {
  const r = await env.client.call("routines.set", {
    name: "Breaker",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "break now",
  });
  assert.equal(r.next_run_at, undefined);
  await env.client.call("routines.run", { routine: r.id });
  await ended(r.id, 1);
  assert.equal((await runsOf(r.id))[0]?.state, "failed");
  await waitFor(() => tg.messagesTo(OWNER_CHAT).some((m) => /Breaker/.test(String(m.body.text))), "failure told");

  await assert.rejects(
    env.client.call("routines.set", {
      name: "x",
      agent: "roby",
      schedule: { kind: "cron", cron: "99 * * * *" },
      prompt: "p",
    }),
    (e: unknown) => e instanceof ApxError && /outside/.test(e.message),
  );
  await assert.rejects(
    env.client.call("routines.set", {
      name: "x",
      agent: "roby",
      schedule: { kind: "once", at: new Date(2020, 0, 1).toISOString() },
      prompt: "p",
    }),
    (e: unknown) => e instanceof ApxError && /passed/.test(e.message),
  );
});

test("a new routine keeps an imminent slot; a running one is not started again; run now conflicts", async () => {
  clock = new Date(2026, 9, 7, 8, 57);
  const r = await env.client.call("routines.set", {
    name: "Soon",
    agent: "roby",
    schedule: { kind: "cron", cron: "0 9 * * *" },
    prompt: "anything new?",
  });
  assert.equal(r.next_run_at, new Date(2026, 9, 7, 9, 0).toISOString(), "today at 09:00, not tomorrow");
  // A run still going (it waits for the owner) keeps the routine even when its lease is over.
  const run = await env.client.call("routines.run", { routine: r.id });
  await ended(r.id, 1);
  const rec = env.core.store.runs.get(run.run_id);
  if (rec) env.core.store.runs.setState(rec, "input-required");
  await assert.rejects(
    env.client.call("routines.run", { routine: r.id }),
    (e: unknown) => e instanceof ApxError && /running already/.test(e.message),
  );
  clock = new Date(2026, 9, 7, 11, 0);
  env.core.scheduler.tick();
  assert.equal((await runsOf(r.id)).length, 1);
});

test("an agent cannot touch routines, notices or read marks", async () => {
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  for (const call of [
    () => agent.call("routines.list", {}),
    () => agent.call("notifications.read", {}),
    () => agent.call("threads.read", { thread: "home" }),
  ])
    await assert.rejects(call(), (e: unknown) => e instanceof ApxError && /reserved to the owner/.test(e.message));
});
