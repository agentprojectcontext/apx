// Answering a burst once, a couple of seconds later.
//
// People write in three messages: "hola", "che", then the question. Replying to
// the first the instant it lands answers a third of a thought and produces
// three replies to one message — and a reply that arrives in under a second
// reads as a machine, which on this channel is exactly what it must not.
//
// So the newest message in a chat wins: an earlier turn still inside the window
// stands down, and the later one answers everything (the thread it reads holds
// what was said in between).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-settle-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { settleDelay, _resetSettle } = await import("#core/channels/whatsapp/dispatch.js");
const { DEFAULT_REPLY_DELAY_MS, readWhatsAppConfig, patchWhatsAppConfig } =
  await import("#core/channels/whatsapp/config.js");

const CHAT = "5491155550001@s.whatsapp.net";
/** A sleep that records how long it was asked for and returns at once. */
const spySleep = (waits) => async (ms) => { waits.push(ms); };

test("the answer waits, and by default it waits a couple of seconds", async () => {
  _resetSettle();
  const waits = [];
  const go = await settleDelay({ chatJid: CHAT, messageId: "A1", cfg: {}, sleep: spySleep(waits) });
  assert.equal(go, true, "nothing else arrived — this turn answers");
  assert.deepEqual(waits, [DEFAULT_REPLY_DELAY_MS]);
});

test("a second message inside the window takes the turn over", async () => {
  _resetSettle();
  const waits = [];
  // The first message's wait is where the second one lands: `sleep` is the
  // window, so registering the newer message from inside it is exactly what
  // happens on the wire.
  const sleep = async (ms) => {
    waits.push(ms);
    await settleDelay({ chatJid: CHAT, messageId: "A2", cfg: { whatsapp: { reply_delay_ms: 0 } } });
  };
  const first = await settleDelay({ chatJid: CHAT, messageId: "A1", cfg: {}, sleep });
  assert.equal(first, false, "the first turn stands down");
});

test("two people talking at once do not stand each other down", async () => {
  _resetSettle();
  const other = "5491155550002@s.whatsapp.net";
  await settleDelay({ chatJid: other, messageId: "B1", cfg: { whatsapp: { reply_delay_ms: 0 } } });
  const mine = await settleDelay({ chatJid: CHAT, messageId: "A9", cfg: { whatsapp: { reply_delay_ms: 0 } } });
  assert.equal(mine, true, "the window is per chat, not global");
});

test("zero means answer now, and the wait is capped", async () => {
  _resetSettle();
  const waits = [];
  assert.equal(await settleDelay({ chatJid: CHAT, messageId: "C1", cfg: { whatsapp: { reply_delay_ms: 0 } }, sleep: spySleep(waits) }), true);
  assert.deepEqual(waits, [], "no wait at all, not a zero-length one");

  await settleDelay({ chatJid: CHAT, messageId: "C2", cfg: { whatsapp: { reply_delay_ms: 999_999 } }, sleep: spySleep(waits) });
  assert.equal(waits[0], 30_000, "a typo in a config field cannot park a conversation for a day");

  waits.length = 0;
  await settleDelay({ chatJid: CHAT, messageId: "C3", cfg: { whatsapp: { reply_delay_ms: -5 } }, sleep: spySleep(waits) });
  assert.equal(waits[0], undefined, "negative reads as none");
});

test("the delay is a config key, with the default when nobody set one", () => {
  assert.equal(readWhatsAppConfig().reply_delay_ms, DEFAULT_REPLY_DELAY_MS);
  assert.equal(patchWhatsAppConfig({ reply_delay_ms: 4000 }).reply_delay_ms, 4000);
  assert.equal(readWhatsAppConfig().reply_delay_ms, 4000);
});
