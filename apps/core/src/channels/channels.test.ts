import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { defineTool } from "../tools/types.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { guardReply } from "./guard.ts";
import { inQuietHours } from "./notices.ts";
import { telegramAdapter } from "./telegram.ts";
import { chunks, toTelegramHtml } from "./telegram-format.ts";

const TOKEN = "123456:TEST-token";
const OWNER = { id: 1001, name: "Owner" };
const ANA = { id: 2002, name: "Ana" };

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 80)}`);
  if (said.includes("launch the probe")) return callTool("p1", "probe", {});
  if (said.includes("where do you live")) return say("My files are in /Users/someone/secret/notes.md, **sorry**.");
  if (said.includes("break please")) throw new Error("quota exceeded for this billing account");
  if (said.includes("long answer")) return say(`${"word ".repeat(900)}\n\n${"tail ".repeat(400)}END`);
  return say(`Hello **there**, you said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
});

const probe = defineTool({
  name: "probe",
  description: "test tool that always asks the owner",
  args: z.object({}),
  effect: "external",
  confirm: "always",
  deadlineMs: 60_000,
  title: () => "Probe",
  run: async () => "probed",
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    extraTools: [probe],
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
  });
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "roby" },
    token: TOKEN,
  });
  await until(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await tg.close();
  env.cleanup();
});

test("formatting: Markdown becomes Telegram HTML; contacts never get paths or keys", () => {
  assert.equal(toTelegramHtml("**hi** <b> `a<b`"), "<b>hi</b> &lt;b&gt; <code>a&lt;b</code>");
  assert.equal(toTelegramHtml("# Title\n- one"), "<b>Title</b>\n• one");
  assert.equal(guardReply("see /Users/x/a.txt and sk-abcdefghijklmnopqrstuv"), "see [hidden] and [hidden]");
  const fence = "`".repeat(3);
  const parts = chunks(`${fence}\n${"line of code\n".repeat(600)}${fence}`);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.equal((p.match(/`{3}/g)?.length ?? 0) % 2, 0, "every part has whole code blocks");
});

test("a stranger gets a code; the owner approves it as themselves; then their words reach Home and the answer returns", async () => {
  const info = (await env.client.call("channels.list", {})).channels[0];
  assert.equal(info?.account, "@apx_test_bot");
  assert.equal(info?.token_set, true);
  // The owner recognizes the stored token without it ever coming back whole.
  assert.equal(info?.token_hint, "123456:••••oken");

  tg.message(OWNER, "hola");
  await until(() => tg.messagesTo(OWNER.id).length === 1, "pairing message");
  const code = /(\d{6})/.exec(String(tg.messagesTo(OWNER.id)[0]?.body.text))?.[1] ?? "";
  tg.message(OWNER, "hola otra vez");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(tg.messagesTo(OWNER.id).length, 1, "one code per stranger, not one per message");
  const { requests } = await env.client.call("pairing.list", {});
  assert.equal(requests[0]?.code, code);

  await env.client.call("pairing.respond", { code, decision: "owner" });
  tg.message(OWNER, "what is up");
  await until(() => tg.messagesTo(OWNER.id).length === 2, "owner reply");
  const reply = tg.messagesTo(OWNER.id)[1]?.body;
  assert.equal(reply?.parse_mode, "HTML");
  assert.match(String(reply?.text), /<b>there<\/b>, you said: what is up/);
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(
    home.messages.some(
      (m) => m.author.kind === "user" && m.parts.some((p) => p.type === "text" && p.text === "what is up"),
    ),
  );

  // Written in the app, the answer stays in the app.
  await env.client.call("threads.send", { thread: "home", text: "from the app" });
  await env.settle("home");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(tg.messagesTo(OWNER.id).length, 2);
});

test("a confirmation reaches the owner with buttons and a press approves it", async () => {
  tg.message(OWNER, "launch the probe");
  await until(() => tg.messagesTo(OWNER.id).some((m) => m.body.reply_markup), "buttons");
  const ask = tg.messagesTo(OWNER.id).find((m) => m.body.reply_markup);
  const markup = ask?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
  const allow = markup.inline_keyboard[0]?.[0]?.callback_data ?? "";
  assert.match(allow, /^i:.+:a$/);
  // Someone else pressing it changes nothing.
  tg.press(ANA, allow);
  await new Promise((r) => setTimeout(r, 150));
  tg.press(OWNER, allow);
  await until(() => tg.messagesTo(OWNER.id).some((m) => /Done: probed/.test(String(m.body.text))), "probe result");
});

test("a contact gets a sealed agent: no tools, no owner context, and a filtered reply", async () => {
  tg.message(ANA, "hi, who are you");
  await until(() => tg.messagesTo(ANA.id).length === 1, "pairing for Ana");
  const code = /(\d{6})/.exec(String(tg.messagesTo(ANA.id)[0]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "contact", name: "Ana" });

  tg.message(ANA, "where do you live");
  await until(() => tg.messagesTo(ANA.id).length === 2, "contact reply");
  assert.match(String(tg.messagesTo(ANA.id)[1]?.body.text), /My files are in \[hidden\]/);
  const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("where do you live"));
  assert.match(String(call?.messages[0]?.content), /Ana is NOT your owner/);
  assert.equal(call?.tools.length, 0);
  assert.match(String(call?.messages.at(-1)?.content), /trust="untrusted"/);
  const { threads } = await env.client.call("threads.list", {});
  const t = threads.find((x) => x.kind === "channel" && x.title === "Ana");
  assert.ok(t?.channel?.person_id);
});

test("groups are ignored and a redelivered update is handled once", async () => {
  const before = tg.messagesTo(-500).length;
  tg.message(OWNER, "in a group", { id: -500, type: "group" });
  const id = tg.message(OWNER, "only once please");
  await until(() => tg.messagesTo(OWNER.id).some((m) => /only once please/.test(String(m.body.text))), "reply");
  const count = () => tg.messagesTo(OWNER.id).filter((m) => /only once please/.test(String(m.body.text))).length;
  // A crash between storing and confirming: a restarted channel gets the same update again.
  tg.redeliver(id, OWNER, "only once please");
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" } });
  await until(() => !tg.queued().includes(id), "the redelivered update was fetched and confirmed");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(count(), 1);
  assert.equal(tg.messagesTo(-500).length, before);
});

test("a rate-limited send is retried; an ambiguous failure is marked uncertain, never resent", async () => {
  tg.failures.set("sendMessage", [
    {
      status: 429,
      body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0 } },
    },
  ]);
  tg.message(OWNER, "rate limited");
  await until(() => tg.messagesTo(OWNER.id).some((m) => /rate limited/.test(String(m.body.text))), "retried reply");

  tg.failures.set("sendMessage", [{ status: 502, body: { ok: false, error_code: 502, description: "Bad Gateway" } }]);
  tg.message(OWNER, "gateway trouble");
  await until(async () => {
    const { items } = await env.client.call("channels.outbox", {});
    return items.some((i) => i.state === "uncertain" && /gateway trouble/.test(i.text));
  }, "uncertain");
});

test("quiet hours cross midnight; inside them notices arrive without sound", () => {
  const prefs = { quiet_from: "23:00", quiet_to: "08:00", inputs_after_s: 120 };
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
  assert.equal(inQuietHours(prefs, at(23, 30)), true);
  assert.equal(inQuietHours(prefs, at(7, 59)), true);
  assert.equal(inQuietHours(prefs, at(8, 0)), false);
  assert.equal(inQuietHours(prefs, at(15)), false);
  assert.equal(inQuietHours({ inputs_after_s: 0 }, at(23, 30)), false);
});

test("a confirmation left unanswered in the app follows the owner to Telegram, silently in quiet hours", async () => {
  await env.client.call("notices.set", { inputs_after_s: 1, quiet_from: "00:00", quiet_to: "23:59" });
  const before = tg.messagesTo(OWNER.id).length;
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "launch the probe" });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(tg.messagesTo(OWNER.id).length, before, "it waits in the app first");
  await until(() => tg.messagesTo(OWNER.id).length > before, "follow-up on Telegram", 4000);
  const ask = tg.messagesTo(OWNER.id).at(-1)?.body;
  assert.ok(ask?.reply_markup);
  assert.equal(ask?.disable_notification, true);
  const markup = ask?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
  tg.press(OWNER, markup.inline_keyboard[1]?.[0]?.callback_data ?? "");
  await env.settle(t.id);
  await env.client.call("notices.set", { inputs_after_s: 120 });
});

test("a contact never sees what went wrong inside APX; the owner does", async () => {
  tg.message(ANA, "break please");
  await until(
    () => tg.messagesTo(ANA.id).some((m) => /can't answer right now|no puedo responder/.test(String(m.body.text))),
    "generic apology",
  );
  assert.ok(!tg.messagesTo(ANA.id).some((m) => /quota|billing/.test(String(m.body.text))));
  await until(() => tg.messagesTo(OWNER.id).some((m) => /quota exceeded/.test(String(m.body.text))), "owner hears why");
});

test("a long reply interrupted after its first part resumes from the next part, without repeating", async () => {
  tg.failures.set("sendMessage", [
    null,
    {
      status: 429,
      body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0 } },
    },
  ]);
  const before = tg.messagesTo(OWNER.id).length;
  tg.message(OWNER, "long answer");
  await until(() => tg.messagesTo(OWNER.id).some((m) => /END/.test(String(m.body.text))), "the last part");
  const parts = tg
    .messagesTo(OWNER.id)
    .slice(before)
    .filter((m) => /word|tail/.test(String(m.body.text)));
  assert.equal(parts.length, 2, "two parts in all: the first one was not sent again");
});

test("a refused connection is retried (nothing went out); two quick saves leave one poller", async () => {
  // A port that was just closed: the connection is refused before anything is sent.
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const offline = telegramAdapter(
    {
      id: "x",
      type: "telegram",
      label: "x",
      enabled: true,
      agent_id: "roby",
      strangers: "pair",
      concurrency: "queue",
      owner_thread: "home",
    },
    TOKEN,
    `http://127.0.0.1:${port}`,
  );
  const err = await offline.send("1", { text: "hi" }).catch((e: unknown) => e);
  assert.equal((err as { kind?: string }).kind, "retry");

  const save = () => env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" } });
  await Promise.all([save(), save()]);
  await new Promise((r) => setTimeout(r, 200));
  const a = tg.polls();
  await new Promise((r) => setTimeout(r, 500));
  // One poller with nothing to read makes about one poll per 50 ms here; two would make twice as many.
  assert.ok(tg.polls() - a < 16, `polls in 500 ms: ${tg.polls() - a}`);
});
