import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { settingsCore } from "./settings.test-support.ts";

// Attention hours are changed from chat through apx_settings: a channel's hours with channels.set, a contact let
// through them with contacts.set. The owner's card reads them in words.
const TOKEN = "123456:TEST-hours";
const WEEKDAYS = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };

let h: Awaited<ReturnType<typeof settingsCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let dad = "";

before(async () => {
  tg = await fakeTelegram(TOKEN);
  h = await settingsCore({ channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await h.env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", label: "Acme bot", agent_id: "roby", strangers: "ask", research: "off" },
    token: TOKEN,
  });
  dad = (await h.env.client.call("contacts.set", { name: "Northwind Dad", nickname: "Dad", relation: "family" })).id;
});
after(async () => {
  await h.env.core.close();
  await tg.close();
  await h.env.cleanup();
});

const channel = async () => (await h.env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
const person = async (id: string) => (await h.env.client.call("contacts.list", {})).persons.find((p) => p.id === id);

test("only apx_settings sets hours: there is no tool of their own", async () => {
  await h.ask("hello");
  const offered = h.llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  assert.ok(offered.includes("apx_settings"));
  assert.ok(!offered.includes("attention_hours"));
  assert.match((await h.ask({ method: "channels.list" })).answer, /Acme bot \[tg\] \(.*any hour/);
});

test("the owner approves a channel's hours read in words, and the channel keeps its other settings", async () => {
  const { answer, detail } = await h.ask(
    { method: "channels.set", params: { id: "tg", channel: { hours: WEEKDAYS } } },
    "approve",
  );
  assert.match(detail, /^Change the channel Acme bot/);
  assert.match(detail, /Answers contacts Mon–Fri 09:00–18:00 \(.+\); outside them they wait until the hours begin/);
  assert.doesNotMatch(detail, /hours\.days|"from"/);
  assert.match(answer, /^done:/);
  const ch = await channel();
  assert.deepEqual(ch?.hours, WEEKDAYS);
  assert.equal(ch?.strangers, "ask");
  assert.equal(ch?.research, "off");
  assert.equal(ch?.token_set, true);
});

test("a contact is let through the hours, and stops being let through, on a card in words", async () => {
  const through = await h.ask({ method: "contacts.set", params: { id: dad, any_hour: true } }, "approve");
  assert.match(through.detail, /^Change the contact Northwind Dad\nAnswered at any hour$/);
  assert.equal((await person(dad))?.any_hour, true);
  await h.ask({ method: "contacts.set", params: { id: dad, any_hour: false } }, "deny");
  assert.equal((await person(dad))?.any_hour, true, "a declined change saves nothing");
  const wait = await h.ask({ method: "contacts.set", params: { id: dad, any_hour: false } }, "approve");
  assert.match(wait.detail, /Waits for the hours like everyone/);
  assert.equal((await person(dad))?.any_hour, false);
});

test("hours: null puts a channel back to any hour, and the card says so", async () => {
  const { detail } = await h.ask({ method: "channels.set", params: { id: "tg", channel: { hours: null } } }, "approve");
  assert.match(detail, /Answers contacts at any hour/);
  const ch = await channel();
  assert.equal(ch?.hours, undefined);
  assert.equal(ch?.strangers, "ask");
});

test("hours for a channel that is not there are refused before the owner is asked", async () => {
  const { answer } = await h.ask({ method: "channels.set", params: { id: "nowhere", channel: { hours: WEEKDAYS } } });
  assert.match(answer, /no channel "nowhere"/);
});
