import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { z } from "zod";
import { inQuietHours } from "../domain/notices.ts";
import { OWNER_ID } from "../domain/persons.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { guardReply } from "./guard.ts";
import { telegramAdapter } from "./telegram.ts";
import { chunks, toTelegramHtml } from "./telegram-format.ts";
import { type ChannelAdapter, SendError } from "./types.ts";

const TOKEN = "123456:TEST-token";
const OWNER = { id: 1001, name: "Owner" };
const ANA = { id: 2002, name: "Ana" };
const SECOND = { id: 3003, name: "Owner (work phone)" };

const llm = scriptedLlm((req, { said, afterTool }) => {
  const last = String(req.messages.at(-1)?.content);
  if (last.startsWith("[The owner adds")) return say(`Steered: ${last.split("\n")[1]}`);
  if (said.includes("slow job") && !afterTool) return callTool("s1", "slowpoke", {});
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 80)}`);
  if (said.includes("launch the probe")) return callTool("p1", "probe", {});
  if (said.includes("pick the days"))
    return callTool("q1", "ask_owner", {
      question: "Which days work for the Northwind review?",
      options: ["Mon", "Tue", "Wed"],
      multi: true,
    });
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

/** A tool that holds its turn until the test lets it go (or the turn is stopped). */
const gate = { waiting: false, open: () => {} };
const slowpoke = defineTool({
  name: "slowpoke",
  description: "test tool that waits",
  args: z.object({}),
  effect: "none",
  deadlineMs: 60_000,
  title: () => "Slowpoke",
  run: (_a, ctx) =>
    new Promise<string>((resolve) => {
      gate.waiting = true;
      gate.open = () => {
        gate.waiting = false;
        resolve("slow done");
      };
      ctx.signal.addEventListener("abort", () => gate.open(), { once: true });
    }),
});

/** A channel that runs but refuses every message, as Discord does for a channel id it does not know. */
const refusing: ChannelAdapter = {
  caps: { typing: false, buttons: false },
  start: async () => ({ account: "@refusing" }),
  stop: async () => {},
  send: async () => {
    throw new SendError("fatal", "Unknown Channel");
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    extraTools: [probe, slowpoke],
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url), discord: () => refusing },
  });
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "roby" },
    token: TOKEN,
  });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
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
  await waitFor(() => tg.messagesTo(OWNER.id).length === 1, "pairing message");
  const code = /(\d{6})/.exec(String(tg.messagesTo(OWNER.id)[0]?.body.text))?.[1] ?? "";
  tg.message(OWNER, "hola otra vez");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(tg.messagesTo(OWNER.id).length, 1, "one code per stranger, not one per message");
  const { requests } = await env.client.call("pairing.list", {});
  assert.equal(requests[0]?.code, code);

  await env.client.call("pairing.respond", { code, decision: "owner" });
  tg.message(OWNER, "what is up");
  await waitFor(() => tg.messagesTo(OWNER.id).length === 2, "owner reply");
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

test("while the agent works the owner sees typing, never a streamed draft that would lock their chat", async () => {
  tg.message(OWNER, "stream this");
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /you said: stream this/.test(String(m.body.text))), "reply");
  assert.ok(tg.sent.some((m) => m.method === "sendChatAction" && String(m.body.chat_id) === String(OWNER.id)));
  assert.equal(tg.sent.filter((m) => m.method === "sendMessageDraft").length, 0);
});

test("a message while the agent works joins its turn; a short stop ends it without a new one", async () => {
  const toOwner = () => tg.messagesTo(OWNER.id).map((m) => String(m.body.text));
  const runCount = async () => (await env.client.call("threads.get", { thread: "home" })).runs.length;
  const runsBefore = await runCount();
  tg.message(OWNER, "slow job");
  await waitFor(() => gate.waiting, "tool running");
  tg.message(OWNER, "also add the totals");
  await waitFor(async () => {
    const home = await env.client.call("threads.get", { thread: "home" });
    return home.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === "also add the totals"));
  }, "second message kept");
  gate.open();
  await waitFor(() => toOwner().some((t) => t.includes("Steered: also add the totals")), "steered answer");
  assert.equal(await runCount(), runsBefore + 1, "both messages in one turn");

  const before = toOwner().length;
  tg.message(OWNER, "slow job");
  await waitFor(() => gate.waiting, "tool running again");
  tg.message(OWNER, "Pará");
  await waitFor(() => toOwner().includes("Listo, paré."), "stop acknowledged");
  await waitFor(() => !gate.waiting, "tool stopped");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(toOwner().slice(before), ["Listo, paré."], "no half answer and no answer to the stop");
  const after = await env.client.call("threads.get", { thread: "home" });
  assert.equal(after.runs.length, runsBefore + 2, "the stop started no turn");
  assert.equal(after.runs[0]?.state, "canceled", "runs are newest first");
});

test("a confirmation reaches the owner with buttons and a press approves it", async () => {
  tg.message(OWNER, "launch the probe");
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => m.body.reply_markup), "buttons");
  const ask = tg.messagesTo(OWNER.id).find((m) => m.body.reply_markup);
  const markup = ask?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
  const allow = markup.inline_keyboard[0]?.[0]?.callback_data ?? "";
  assert.match(allow, /^i:.+:a$/);
  // Someone else pressing it changes nothing.
  tg.press(ANA, allow);
  await new Promise((r) => setTimeout(r, 150));
  tg.press(OWNER, allow, ask?.message_id);
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /Done: probed/.test(String(m.body.text))), "probe result");
  // Answered right there: the question stays in the chat.
  assert.ok(!tg.sent.some((s) => s.method === "deleteMessage" && s.body.message_id === ask?.message_id));
});

test("a confirmation answered in the app is taken out of Telegram; a press on it after says it is gone", async () => {
  const before = tg.messagesTo(OWNER.id).length;
  tg.message(OWNER, "launch the probe");
  await waitFor(
    () =>
      tg
        .messagesTo(OWNER.id)
        .slice(before)
        .some((m) => m.body.reply_markup),
    "buttons",
  );
  const ask = tg
    .messagesTo(OWNER.id)
    .slice(before)
    .find((m) => m.body.reply_markup);
  const markup = ask?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
  const allow = markup.inline_keyboard[0]?.[0]?.callback_data ?? "";
  const inputId = allow.split(":")[1] ?? "";
  await env.client.call("runs.respond", { input: inputId, decision: "approve" });
  await waitFor(
    () => tg.sent.some((s) => s.method === "deleteMessage" && s.body.message_id === ask?.message_id),
    "the question deleted",
  );
  await waitFor(
    () =>
      tg
        .messagesTo(OWNER.id)
        .slice(before)
        .some((m) => /Done: probed/.test(String(m.body.text))),
    "current probe result",
  );
  const seen = tg.messagesTo(OWNER.id).length;
  tg.press(OWNER, allow, ask?.message_id);
  await waitFor(
    () =>
      tg
        .messagesTo(OWNER.id)
        .slice(seen)
        .some((m) => /ya no está pendiente/.test(String(m.body.text))),
    "stale press answered",
  );
  assert.match(
    tg
      .messagesTo(OWNER.id)
      .slice(seen)
      .map((m) => String(m.body.text))
      .join("\n"),
    /ya no está pendiente/,
  );
});

test("a multi-choice question is ticked on Telegram, then sent; a question can be skipped", async () => {
  type Markup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  const ask = async () => {
    const before = tg.messagesTo(OWNER.id).length;
    tg.message(OWNER, "pick the days");
    await waitFor(
      () =>
        tg
          .messagesTo(OWNER.id)
          .slice(before)
          .some((m) => m.body.reply_markup),
      "question",
    );
    const m = tg
      .messagesTo(OWNER.id)
      .slice(before)
      .find((x) => x.body.reply_markup);
    const keys = (m?.body.reply_markup as Markup | undefined)?.inline_keyboard.map((r) => r[0]) ?? [];
    return { id: m?.message_id, keys };
  };
  const edits = (id: number | undefined) =>
    tg.sent.filter((s) => s.method === "editMessageReplyMarkup" && s.body.message_id === id);

  const q = await ask();
  assert.deepEqual(
    q.keys.map((k) => k?.text),
    ["☐ Mon", "☐ Tue", "☐ Wed", "Enviar", "Omitir"],
  );
  const data = (label: string) => q.keys.find((k) => k?.text.endsWith(label))?.callback_data ?? "";
  tg.press(OWNER, data("Enviar"), q.id);
  await waitFor(
    () => tg.messagesTo(OWNER.id).some((m) => /al menos una opción/.test(String(m.body.text))),
    "pick some",
  );
  tg.press(OWNER, data("Mon"), q.id);
  await waitFor(() => edits(q.id).length === 1, "Mon ticked");
  tg.press(OWNER, data("Wed"), q.id);
  await waitFor(() => edits(q.id).length === 2, "Wed ticked");
  const ticked = (edits(q.id)[1]?.body.reply_markup as Markup | undefined)?.inline_keyboard.map((r) => r[0]?.text);
  assert.deepEqual(ticked?.slice(0, 3), ["☑ Mon", "☐ Tue", "☑ Wed"]);
  tg.press(OWNER, data("Enviar"), q.id);
  await waitFor(
    () => tg.messagesTo(OWNER.id).some((m) => /Done: The owner answered: Mon, Wed/.test(String(m.body.text))),
    "answer with both",
  );
  const last = edits(q.id).at(-1)?.body.reply_markup as Markup | undefined;
  assert.deepEqual(last?.inline_keyboard, [], "sent: the buttons go");

  const skip = await ask();
  tg.press(OWNER, skip.keys.find((k) => k?.text === "Omitir")?.callback_data ?? "", skip.id);
  await waitFor(
    () => tg.messagesTo(OWNER.id).some((m) => /Done: The owner answered: \(omitida\)/.test(String(m.body.text))),
    "skipped",
  );
});

test("a contact gets a sealed agent: no tools, no owner context, and a filtered reply", async () => {
  tg.message(ANA, "hi, who are you");
  await waitFor(() => tg.messagesTo(ANA.id).length === 1, "pairing for Ana");
  const code = /(\d{6})/.exec(String(tg.messagesTo(ANA.id)[0]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "contact", name: "Ana" });

  tg.message(ANA, "where do you live");
  await waitFor(() => tg.messagesTo(ANA.id).length === 2, "contact reply");
  assert.match(String(tg.messagesTo(ANA.id)[1]?.body.text), /My files are in \[hidden\]/);
  const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("where do you live"));
  assert.match(String(call?.messages[0]?.content), /Ana is NOT your owner/);
  assert.equal(call?.tools.length, 0);
  assert.match(String(call?.messages.at(-1)?.content), /trust="untrusted"/);
  const { threads } = await env.client.call("threads.list", {});
  const t = threads.find((x) => x.kind === "channel" && x.title === "Ana");
  assert.ok(t?.channel?.person_id);
});

test("an account approved as a contact by mistake becomes the owner's: its chat follows, the contact goes", async () => {
  tg.message(SECOND, "hello from my other phone");
  await waitFor(() => tg.messagesTo(SECOND.id).length === 1, "pairing for the second phone");
  const code = /(\d{6})/.exec(String(tg.messagesTo(SECOND.id)[0]?.body.text))?.[1] ?? "";
  const { person } = await env.client.call("pairing.respond", { code, decision: "contact" });
  const address = person?.addresses[0]?.id ?? "";

  // The code is spent: answering it again says what became of it instead of "not found".
  await assert.rejects(
    env.client.call("pairing.respond", { code, decision: "owner" }),
    (e: Error & { detail?: unknown }) => {
      assert.deepEqual(e.detail, { pairing: "approved" });
      return true;
    },
  );

  assert.deepEqual(await env.client.call("contacts.claim", { address }), { moved: true });
  const { persons } = await env.client.call("contacts.list", {});
  assert.ok(!persons.some((p) => p.id === person?.id), "the contact is gone");
  assert.ok(persons.find((p) => p.role === "owner")?.addresses.some((a) => a.id === address));
  const { threads } = await env.client.call("threads.list", {});
  assert.ok(!threads.some((t) => t.channel?.person_id === person?.id), "no chat points at the removed contact");

  tg.message(SECOND, "now I am the owner here");
  await waitFor(async () => {
    const home = await env.client.call("threads.get", { thread: "home" });
    return home.messages.some((m) =>
      m.parts.some((x) => x.type === "text" && x.text.includes("now I am the owner here")),
    );
  }, "the owner's words reach Home");
});

test("a removed contact who links the account again as the owner's gets the old chat as their own", async () => {
  const THIRD = { id: 4004, name: "Owner (tablet)" };
  tg.message(THIRD, "hi there");
  await waitFor(() => tg.messagesTo(THIRD.id).length === 1, "pairing for the tablet");
  let code = /(\d{6})/.exec(String(tg.messagesTo(THIRD.id)[0]?.body.text))?.[1] ?? "";
  const { person } = await env.client.call("pairing.respond", { code, decision: "contact", name: "Tablet" });
  tg.message(THIRD, "hello as a contact");
  await waitFor(() => tg.messagesTo(THIRD.id).length === 2, "the contact's reply");
  await env.client.call("contacts.remove", { id: person?.id ?? "" });

  tg.message(THIRD, "it is me");
  await waitFor(() => tg.messagesTo(THIRD.id).length === 3, "a new code");
  code = /(\d{6})/.exec(String(tg.messagesTo(THIRD.id)[2]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "owner" });
  const { threads } = await env.client.call("threads.list", {});
  const chat = threads.find((t) => t.channel?.conversation === String(THIRD.id));
  assert.equal(chat?.channel?.person_id, "owner");
});

test("groups are ignored and a redelivered update is handled once", async () => {
  const before = tg.messagesTo(-500).length;
  tg.message(OWNER, "in a group", { id: -500, type: "group" });
  const id = tg.message(OWNER, "only once please");
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /only once please/.test(String(m.body.text))), "reply");
  const count = () => tg.messagesTo(OWNER.id).filter((m) => /only once please/.test(String(m.body.text))).length;
  // A crash between storing and confirming: a restarted channel gets the same update again.
  tg.redeliver(id, OWNER, "only once please");
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" } });
  await waitFor(() => !tg.queued().includes(id), "the redelivered update was fetched and confirmed");
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
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /rate limited/.test(String(m.body.text))), "retried reply");

  tg.failures.set("sendMessage", [{ status: 502, body: { ok: false, error_code: 502, description: "Bad Gateway" } }]);
  tg.message(OWNER, "gateway trouble");
  await waitFor(async () => {
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
  assert.equal(inQuietHours({}, at(23, 30)), false);
});

test("a confirmation left unanswered in the app follows the owner to Telegram, silently in quiet hours", async () => {
  const hour = new Date().getHours();
  const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  await env.client.call("notices.set", { inputs_after_s: 1, quiet_from: hhmm(hour + 23), quiet_to: hhmm(hour + 2) });
  const before = tg.messagesTo(OWNER.id).length;
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "launch the probe" });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(tg.messagesTo(OWNER.id).length, before, "it waits in the app first");
  await waitFor(() => tg.messagesTo(OWNER.id).length > before, "follow-up on Telegram");
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
  await waitFor(
    () => tg.messagesTo(ANA.id).some((m) => /can't answer right now|no puedo responder/.test(String(m.body.text))),
    "generic apology",
  );
  assert.ok(!tg.messagesTo(ANA.id).some((m) => /quota|billing/.test(String(m.body.text))));
  await waitFor(
    () => tg.messagesTo(OWNER.id).some((m) => /quota exceeded/.test(String(m.body.text))),
    "owner hears why",
  );
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
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /END/.test(String(m.body.text))), "the last part");
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

test("a routine's news reaches the owner without buttons; the owner's 👍/👎 reaction rates it", async () => {
  const r = await env.client.call("routines.set", {
    name: "rated-probe",
    agent: "roby",
    schedule: { kind: "manual" },
    action: "message",
    prompt: "Rate me",
    enabled: true,
  });
  await env.client.call("routines.run", { routine: r.id });
  const rated = () => tg.messagesTo(OWNER.id).find((m) => /Rate me/.test(String(m.body.text)));
  await waitFor(() => Boolean(rated()), "routine notice");
  assert.equal(rated()?.body.text, "Rate me", "the routine's words alone, no title");
  assert.equal(rated()?.body.reply_markup, undefined, "no 👍/👎 buttons");
  const id = env.core.store.nudges.list(1)[0]?.id ?? "";
  const msg = rated()?.message_id ?? 0;
  const before = tg.messagesTo(OWNER.id).length;
  tg.react(OWNER, msg, "👎");
  await waitFor(() => env.core.store.nudges.get(id)?.feedback === "down", "👎 kept");
  tg.react(OWNER, msg, "🔥");
  await waitFor(() => env.core.store.nudges.get(id)?.feedback === "up", "🔥 counts as useful");
  tg.react(OWNER, msg);
  await waitFor(() => env.core.store.nudges.get(id)?.feedback === undefined, "taking it off clears it");
  // Someone else's reaction never rates the owner's notices, and rating sends nothing back.
  tg.react(ANA, msg, "👍");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(env.core.store.nudges.get(id)?.feedback, undefined);
  assert.equal(tg.messagesTo(OWNER.id).length, before);
});

test("a notice the owner's chosen channel refuses goes to the next channel that knows them", async () => {
  await env.client.call("channels.set", { id: "dc", channel: { type: "discord", agent_id: "roby" }, token: TOKEN });
  env.core.store.persons.link(OWNER_ID, { channel: "dc", external_id: "424242", label: "Discord" });
  const prefs = await env.client.call("notices.get", {});
  await env.client.call("notices.set", { ...prefs, channel: "dc" });
  try {
    const r = await env.client.call("routines.set", {
      name: "fallback-probe",
      agent: "roby",
      schedule: { kind: "manual" },
      action: "message",
      prompt: "Evening brief",
      enabled: true,
    });
    await env.client.call("routines.run", { routine: r.id });
    const outbox = () => env.core.store.channels.outbox.recent(20).filter((o) => o.text === "Evening brief");
    // Telegram has the message a moment before its row is marked sent: wait for the row, not the message.
    await waitFor(() => outbox().some((o) => o.channel === "tg" && o.state === "sent"), "notice sent on Telegram");
    assert.ok(tg.messagesTo(OWNER.id).some((m) => m.body.text === "Evening brief"));
    assert.deepEqual(
      outbox()
        .map((o) => [o.channel, o.state])
        .sort(),
      [
        ["dc", "failed"],
        ["tg", "sent"],
      ],
    );
  } finally {
    await env.client.call("notices.set", prefs);
    await env.client.call("channels.set", { id: "dc", channel: null });
  }
});
