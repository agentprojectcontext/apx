// Every WhatsApp send leaves a record — from every door.
//
// The bug these cover: `send_whatsapp` (the tool) and POST /api/whatsapp/send
// reached `session.sendText` directly, so only an auto-reply to an inbound
// message was ever written to the ledger. A message the agent sent because
// somebody ASKED for one left no trace, and a peer agent reading the log
// concluded the send had never happened and made it happen twice.
//
// Every test here fails against that code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-outbox-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { sendWhatsApp, outboundContactKey } = await import("#core/channels/whatsapp/outbox.js");
const { claimOwnSend, _resetOwnSends } = await import("#core/channels/whatsapp/echo.js");
const { readGlobalMessages } = await import("#core/stores/messages.js");
const { CHANNELS } = await import("#core/constants/channels.js");

const CONTACT = "5491155550001@s.whatsapp.net";
const OWNER = "5491155559999@s.whatsapp.net";

const config = {
  whatsapp: {
    owner_jid: OWNER,
    contacts: [{ jid: CONTACT, name: "Northwind Sam", role: "contact", auto_reply: true }],
  },
};

/** A session that records what it was asked to send instead of sending it. */
function fakeSession() {
  const sent = [];
  let n = 0;
  return {
    sent,
    async sendText(jid, text) {
      sent.push({ kind: "text", jid, text });
      return { key: { id: `MSG${++n}`, remoteJid: jid, fromMe: true } };
    },
    async sendSticker(jid, file) {
      sent.push({ kind: "sticker", jid, file });
      return { key: { id: `MSG${++n}`, remoteJid: jid, fromMe: true } };
    },
    async sendReaction(jid, key, emoji) {
      sent.push({ kind: "reaction", jid, key, emoji });
      return { key: { id: `MSG${++n}` } };
    },
  };
}

const outRows = () =>
  readGlobalMessages({ channel: CHANNELS.WHATSAPP, limit: 200 }).filter((r) => r.direction === "out");

test("a sent message is on the ledger before the call returns", async () => {
  _resetOwnSends();
  const before = outRows().length;
  const session = fakeSession();

  const res = await sendWhatsApp({
    session,
    globalConfig: config,
    to: CONTACT,
    text: "the endpoint is live",
  });

  assert.equal(res.sent, true);
  assert.ok(res.id, "the send returns the id WhatsApp gave the message");

  const rows = outRows();
  assert.equal(rows.length, before + 1, "exactly one row was written");
  const row = rows.at(-1);
  assert.equal(row.body, "the endpoint is live");
  assert.equal(row.external_id, res.id, "the row carries the same id the caller was handed");
  assert.equal(row.meta.chat_jid, CONTACT);
});

test("an outgoing row files under the SAME thread as the contact's replies", async () => {
  _resetOwnSends();
  const session = fakeSession();
  await sendWhatsApp({ session, globalConfig: config, to: CONTACT, text: "hello" });

  // `contact_key` is what splits one day file into one thread per person. An
  // outgoing row that carried a different key would open a second thread for
  // the same human — a conversation showing only one side of itself.
  assert.equal(outRows().at(-1).meta.contact_key, CONTACT);
  assert.equal(outboundContactKey(config, CONTACT), CONTACT);
});

test("a message to our own number files under the owner thread", () => {
  assert.equal(outboundContactKey(config, OWNER), "owner");
});

test("a phone number in any format reaches the same thread as its JID", async () => {
  _resetOwnSends();
  const session = fakeSession();
  await sendWhatsApp({ session, globalConfig: config, to: "+54 9 11 5555-0001", text: "loose format" });
  const row = outRows().at(-1);
  assert.equal(row.meta.contact_key, CONTACT, "the roster jid, not the typed string");
});

test("a sticker is recorded by what it MEANS, not by its file path", async () => {
  _resetOwnSends();
  const session = fakeSession();
  await sendWhatsApp({
    session,
    globalConfig: config,
    to: CONTACT,
    stickerFile: "/path/to/thumbs-up.webp",
    stickerLabel: "pulgar arriba",
  });
  const row = outRows().at(-1);
  assert.match(row.body, /pulgar arriba/);
  assert.doesNotMatch(row.body, /\.webp/, "the reader wants the gesture, not the disk");
});

test("a reaction is sent but not logged as something said", async () => {
  _resetOwnSends();
  const before = outRows().length;
  const session = fakeSession();
  const res = await sendWhatsApp({
    session,
    globalConfig: config,
    to: CONTACT,
    reactTo: { id: "ABC", remoteJid: CONTACT },
    text: "👍",
  });
  assert.equal(res.sent, false);
  assert.equal(session.sent.at(-1).kind, "reaction");
  assert.equal(outRows().length, before, "a mark on a message is not a message");
});

test("an empty body is refused rather than sent", async () => {
  const session = fakeSession();
  await assert.rejects(
    () => sendWhatsApp({ session, globalConfig: config, to: CONTACT, text: "   " }),
    /empty message/,
  );
  assert.equal(session.sent.length, 0);
});

test("an unusable recipient is refused before anything is sent", async () => {
  const session = fakeSession();
  await assert.rejects(
    () => sendWhatsApp({ session, globalConfig: config, to: "not a phone", text: "hi" }),
    /not a usable phone number/,
  );
  assert.equal(session.sent.length, 0);
});

test("our own send is claimed, so its echo does not become a second row", async () => {
  _resetOwnSends();
  const session = fakeSession();
  const res = await sendWhatsApp({ session, globalConfig: config, to: CONTACT, text: "once" });

  // This is what the socket does when WhatsApp mirrors our own message back.
  assert.equal(claimOwnSend(res.id), true, "the echo is recognised as ours");
  // And a second delivery of the same echo (a reconnect replays it) is no
  // longer claimed — but by then the id is spent, so nothing files it either.
  assert.equal(claimOwnSend(res.id), false);
});

test("a message id we never sent is NOT ours — that is the owner's own phone", () => {
  _resetOwnSends();
  assert.equal(claimOwnSend("SOME-ID-FROM-THE-HANDSET"), false);
});
