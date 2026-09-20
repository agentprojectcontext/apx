// Why a WhatsApp message did not go out, three deterministic ways.
//
// From the 2026-09-20 audit and the afternoon that produced it: the owner
// watched the agent hold a perfectly normal conversation with a contact, then
// become unable to answer her. "Vos estuviste hablando con ella re tranquila,
// de repente te dejó un mensaje, se te trabó todo, y ahora no le puedes
// responder." Nothing was broken on the socket. Three separate things in this
// repo each guaranteed a failure on their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schemasForChannel } from "#core/agent/tools/registry.js";
import sendWhatsapp from "#core/agent/tools/handlers/send-whatsapp.js";
import { CHANNELS } from "#core/constants/channels.js";

const names = (channel) => schemasForChannel(channel).map((s) => s.function?.name || s.name);

test("a WhatsApp turn is handed the one tool the channel exists for", () => {
  // `send_whatsapp` was in neither BASE_TOOL_NAMES nor FULL_CHANNELS, so it did
  // not travel in the request — while the channel prompt talked about it as if
  // it were loaded and the lazy-tools block showed the NAME with no schema.
  // That is the documented worst case of lazy tools: the model invents the
  // call, burns iterations, and falls back to prose that claims it sent.
  assert.ok(names(CHANNELS.WHATSAPP).includes("send_whatsapp"));
});

test("the other lightweight channels are not widened by that", () => {
  // Telegram keeps `send_telegram` and reaches `send_whatsapp` through
  // discover_tools, which is the right shape: writing to somebody on a channel
  // you are NOT in is a deliberate act.
  const tg = names(CHANNELS.TELEGRAM);
  assert.ok(tg.includes("send_telegram"));
  assert.ok(!tg.includes("send_whatsapp"));
});

test("answering the thread you are standing in does not need a confirmation", async () => {
  // `permission_mode` defaults to `automatico` and a WhatsApp turn wires no
  // confirmation dialog, so a `dangerous` call THREW — and the model read
  // "Action requires user confirmation" as one more failed tool, then told the
  // owner it had answered.
  const asked = [];
  const handler = sendWhatsapp.makeHandler({
    channel: CHANNELS.WHATSAPP,
    channelMeta: { chatJid: "5491155555555@s.whatsapp.net" },
    globalConfig: {},
    plugins: null,
    requirePermission: async (tool, opts) => { asked.push(opts); },
  });
  // It gets past the gate and fails later, on the plugin — which is exactly the
  // point: the gate is no longer what stops it.
  await assert.rejects(
    () => handler({ to: "5491155555555", text: "dale, lo vemos el lunes" }),
    /plugins unavailable/,
  );
  assert.equal(asked.length, 1);
  assert.equal(asked[0].dangerous, false, "replying in-thread is the channel's own verb");
});

test("a DIFFERENT recipient still goes through the gate", async () => {
  // The failure worth catching is the right message to the wrong person, and
  // that one is untouched.
  const asked = [];
  const handler = sendWhatsapp.makeHandler({
    channel: CHANNELS.WHATSAPP,
    channelMeta: { chatJid: "5491155555555@s.whatsapp.net" },
    globalConfig: {},
    plugins: null,
    requirePermission: async (tool, opts) => { asked.push(opts); },
  });
  await assert.rejects(() => handler({ to: "5491199999999", text: "hola" }), /plugins unavailable/);
  assert.equal(asked[0].dangerous, true);
});

test("from another channel it is dangerous, thread or no thread", async () => {
  const asked = [];
  const handler = sendWhatsapp.makeHandler({
    channel: CHANNELS.TELEGRAM,
    channelMeta: { chatJid: "5491155555555@s.whatsapp.net" },
    globalConfig: {},
    plugins: null,
    requirePermission: async (tool, opts) => { asked.push(opts); },
  });
  await assert.rejects(() => handler({ to: "5491155555555", text: "hola" }), /plugins unavailable/);
  assert.equal(asked[0].dangerous, true, "a chatJid on a Telegram turn is not a WhatsApp thread");
});

test("the send has a ceiling well under the turn's, not four times over it", () => {
  // These were inverted: Baileys' sendMessage has no timeout of its own, the
  // watchdog fell back to 15 minutes, and the WhatsApp owner turn dies at 6. So
  // the TURN was aborted first and the send outlived it — the owner got "se me
  // colgó ese pedido" while the message was still on its way, and if it landed
  // afterwards nothing logged it. Message delivered, ledger empty.
  const OWNER_DEADLINE_MS = 6 * 60_000;
  assert.equal(typeof sendWhatsapp.deadlineMs, "number");
  assert.ok(sendWhatsapp.deadlineMs < OWNER_DEADLINE_MS, "the tool must give up before the turn does");
  assert.ok(sendWhatsapp.deadlineMs >= 60_000, "and not so early that a healthy socket is called hung");
});
