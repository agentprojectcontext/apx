import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { saveUpload } from "../services/uploads.ts";
import { settingsCore } from "./settings.test-support.ts";

const TOKEN = "123456:TEST-settings";

let h: Awaited<ReturnType<typeof settingsCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
before(async () => {
  tg = await fakeTelegram(TOKEN);
  h = await settingsCore({ channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await h.env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", label: "Acme bot", agent_id: "roby", strangers: "ask", research: "off" },
    token: TOKEN,
  });
  await h.env.client.call("owner.set", { name: "Acme Owner" });
});
after(async () => {
  await h.env.core.close();
  await tg.close();
  await h.env.cleanup();
});

const channel = () => h.env.core.store.settings.read("channels").find((c) => c.id === "tg");

test("channels: a change shows only the fields that change, and keeps the rest and the sign-in", async () => {
  assert.match(
    (await h.ask({ method: "channels.list" })).answer,
    /^- Acme bot \[tg\] \(telegram, on, .*strangers: ask/,
  );
  const call = { method: "channels.set", params: { id: "tg", channel: { strangers: "pair", closers: "react" } } };
  const { detail, answer } = await h.ask(call, "approve");
  assert.match(detail, /^Change the channel Acme bot/);
  assert.match(detail, /channel\.strangers: "ask" → "pair"/);
  assert.match(detail, /channel\.closers: "silent" → "react"/);
  assert.doesNotMatch(detail, /label|research|agent_id|type/);
  assert.match(answer, /^done: saved/);
  assert.equal(channel()?.strangers, "pair");
  assert.equal(channel()?.research, "off");
  assert.equal(channel()?.label, "Acme bot");
  const info = (await h.env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
  assert.equal(info?.token_set, true);
});

test("channels: a declined change leaves the channel as it was", async () => {
  await h.ask({ method: "channels.set", params: { id: "tg", channel: { strangers: "ignore" } } }, "deny");
  assert.equal(channel()?.strangers, "pair");
});

test("channels: the sign-in, removing one, research and a new channel stay the owner's", async () => {
  const set = (params: object) => h.ask({ method: "channels.set", params });
  assert.match((await set({ id: "tg", channel: {}, token: "654321:TEST-other" })).answer, /token stays the owner's/);
  assert.match((await set({ id: "tg", channel: null })).answer, /removing a channel stays the owner's/);
  assert.match((await set({ id: "tg", channel: { research: "everyone" } })).answer, /research stays the owner's/);
  assert.match((await set({ id: "nope", channel: { strangers: "ask" } })).answer, /no channel "nope"/);
  assert.match((await set({ id: "tg", channel: { strangers: "pair" } })).answer, /^nothing to change/);
  assert.equal(channel()?.research, "off");
});

test("channels: iMessage is turned on once the owner approves", async () => {
  const { detail } = await h.ask({ method: "imessage.set", params: { on: true } }, "approve");
  assert.match(detail, /^Turn iMessage on\non: false → true/);
  assert.equal(h.env.core.store.settings.read("imessage").on, true);
});

test("owner: a change to their profile keeps what was not asked", async () => {
  const tz = { method: "owner.set", params: { timezone: "America/New_York" } };
  const { detail } = await h.ask(tz, "approve");
  assert.match(detail, /^Change your profile\ntimezone: \(none\) → "America\/New_York"$/);
  const me = await h.env.client.call("owner.get", {});
  assert.equal(me.timezone, "America/New_York");
  assert.equal(me.name, "Acme Owner");
  assert.equal(me.language, "es");
  await h.ask({ method: "owner.set", params: { language: "en" } }, "deny");
  assert.equal((await h.env.client.call("owner.get", {})).language, "es");
  assert.match((await h.ask({ method: "owner.get" })).answer, /time zone: America\/New_York/);
});

test("notices: quiet hours and the daily budget change, the rest stays", async () => {
  const quiet = { method: "notices.set", params: { quiet_from: "23:00", quiet_to: "08:00", budget_per_day: 5 } };
  const { detail } = await h.ask(quiet, "approve");
  assert.match(detail, /^Change when you are notified/);
  assert.match(detail, /budget_per_day: 3 → 5/);
  assert.match(detail, /quiet_from: \(none\) → "23:00"/);
  const prefs = await h.env.client.call("notices.get", {});
  assert.equal(prefs.budget_per_day, 5);
  assert.equal(prefs.kind_gap_min, 120);
  await h.ask({ method: "notices.set", params: { budget_per_day: 1 } }, "deny");
  assert.equal((await h.env.client.call("notices.get", {})).budget_per_day, 5);
});

test("stickers: the owner approves what a sticker means; the agent reads its stickers first", async () => {
  const webp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
  const media = saveUpload(h.env.home, h.env.core.store, { name: "sticker.webp", mime: "image/webp", bytes: webp });
  const sticker = h.env.core.store.stickers.add({
    platform: "whatsapp",
    hash: "h1",
    media_id: media.id,
    hint: "🧉",
  }).id;
  const list = await h.ask({ method: "stickers.list", params: { platform: "whatsapp" } });
  assert.match(list.answer, new RegExp(`\\[${sticker}\\] not named yet 🧉`));
  const call = { method: "stickers.set", params: { id: sticker, meaning: "mate shared, all good" } };
  const { answer, detail } = await h.ask(call, "approve");
  assert.match(detail, /^Change the sticker/);
  assert.match(detail, /meaning: .* → "mate shared, all good"/);
  assert.match(answer, /"mate shared, all good"/);
  assert.equal(h.env.core.store.stickers.get(sticker)?.meaning, "mate shared, all good");
});
