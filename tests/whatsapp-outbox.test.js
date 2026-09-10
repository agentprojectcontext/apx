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

const { sendWhatsApp, outboundContactKey, chooseWhatsAppOption } = await import("#core/channels/whatsapp/outbox.js");
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
    async sendFile(jid, filePath, opts = {}) {
      sent.push({ kind: "file", jid, path: filePath, opts });
      return { key: { id: `MSG${++n}`, remoteJid: jid, fromMe: true } };
    },
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
    async sendButtonReply(jid, opt) {
      sent.push({ kind: "button_reply", jid, opt });
      return { key: { id: `MSG${++n}`, remoteJid: jid, fromMe: true } };
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

// --- answering a menu -----------------------------------------------------
//
// A bot's menu is answered by TAPPING, not by typing, wherever Baileys can
// encode the tap. Everything below goes through the one send-and-record door,
// so a choice is in the thread exactly like any other message.

const { appendGlobalMessage } = await import("#core/stores/messages.js");

const BOT = "5491155550002@s.whatsapp.net";
const MENU = [
  { n: 1, id: "auto", title: "Autos" },
  { n: 2, id: "hogar", title: "Hogar" },
];

/** Put a menu in the BOT's thread, the way dispatch.js stamps one. */
function offer(kind = "buttons") {
  appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "in",
    type: "user",
    actor_id: BOT,
    body: "Elegí\n[Opciones: 1. Autos | 2. Hogar]",
    external_id: `OFFER-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    meta: { chat_jid: BOT, sender_jid: BOT, interactive_kind: kind, interactive_options: MENU },
  });
}

test("choosing an option sends a real button press, and the thread reads as the label", async () => {
  _resetOwnSends();
  offer("buttons");
  const session = fakeSession();
  const res = await chooseWhatsAppOption({ session, globalConfig: config, to: BOT, option: "2" });

  assert.equal(res.sent, true);
  assert.equal(res.mode, "native");
  const wire = session.sent.at(-1);
  assert.equal(wire.kind, "button_reply", "the bot must see its own button pressed, not a sentence");
  assert.equal(wire.opt.id, "hogar");
  assert.equal(wire.opt.title, "Hogar");
  assert.equal(wire.opt.kind, "buttons");
  assert.equal(wire.opt.index, 1, "options are numbered from 1 for people and from 0 on the wire");

  const row = outRows().at(-1);
  assert.equal(row.body, "Hogar", "an opaque button id in the transcript is not the conversation");
  assert.equal(row.meta.interactive_choice.id, "hogar");
  assert.equal(row.meta.interactive_choice.mode, "native");
});

test("a list is answered with a list reply, not a button one", async () => {
  _resetOwnSends();
  offer("list");
  const session = fakeSession();
  await chooseWhatsAppOption({ session, globalConfig: config, to: BOT, option: "Autos" });
  const wire = session.sent.at(-1);
  assert.equal(wire.kind, "button_reply");
  // The session turns this into a listResponseMessage rather than a
  // buttonsResponseMessage — the receiving client ignores the wrong one.
  assert.equal(wire.opt.kind, "list");
  assert.equal(wire.opt.id, "auto");
});

test("a nativeFlow menu is answered in words — Baileys cannot encode that tap", async () => {
  _resetOwnSends();
  offer("interactive");
  const session = fakeSession();
  const res = await chooseWhatsAppOption({ session, globalConfig: config, to: BOT, option: "autos" });

  assert.equal(res.mode, "text");
  assert.equal(session.sent.at(-1).kind, "text");
  assert.equal(session.sent.at(-1).text, "Autos", "the label is what a person would type");
  assert.equal(outRows().at(-1).body, "Autos");
});

test("as_text forces a typed answer for a menu that ignored the tap", async () => {
  _resetOwnSends();
  offer("buttons");
  const session = fakeSession();
  const res = await chooseWhatsAppOption({ session, globalConfig: config, to: BOT, option: "1", asText: true });
  assert.equal(res.mode, "text");
  assert.equal(session.sent.at(-1).kind, "text");
});

test("no menu, or no match, comes back as words rather than a thrown error", async () => {
  _resetOwnSends();
  const session = fakeSession();

  const nothing = await chooseWhatsAppOption({ session, globalConfig: config, to: CONTACT, option: "1" });
  assert.equal(nothing.ok, false);
  assert.match(nothing.error, /no menu/);

  offer("buttons");
  const miss = await chooseWhatsAppOption({ session, globalConfig: config, to: BOT, option: "moto" });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.available, ["1. Autos", "2. Hogar"], "so it can say the choices without a second call");
  assert.equal(session.sent.length, 0, "nothing was tapped on anybody's behalf");
});

// --- writing to somebody vouches for them ---------------------------------
//
// The roster was fed only by people writing IN, so APX could open a
// conversation and then be structurally unable to continue it: it introduced
// itself to a new collaborator, he answered within the minute, and the reply
// resolved as a stranger's and got silence. Every test here fails against that.

const { resolveReplyPolicy, resolveWhatsAppSender, findWhatsAppContact, REPLY_POLICIES } =
  await import("#core/identity/whatsapp.js");
const { readConfig } = await import("#core/config/index.js");

const NEW_GUY = "5491155550777@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";

/** What would happen if this person answered right now? */
const policyFor = (jid) => {
  const cfg = readConfig();
  return resolveReplyPolicy(cfg, resolveWhatsAppSender({ cfg, addresses: [jid], chatJid: jid }));
};

test("a person APX wrote to first can answer, and is answered", async () => {
  _resetOwnSends();
  const cfg = readConfig();
  assert.equal(policyFor(NEW_GUY), REPLY_POLICIES.SILENT, "a stranger before we write to them");

  await sendWhatsApp({ session: fakeSession(), globalConfig: cfg, to: NEW_GUY, text: "hola, te presento a Roby" });

  assert.equal(
    policyFor(NEW_GUY),
    REPLY_POLICIES.TEXT_ONLY,
    "opening a conversation you cannot continue is the bug this closes"
  );
  const row = findWhatsAppContact(readConfig(), NEW_GUY);
  assert.equal(row.role, "contact");
  assert.ok(row.vouched_by_send, "the roster records WHY this row exists");
});

test("a role the owner set by hand is never overwritten by a send", async () => {
  _resetOwnSends();
  const muted = "5491155550888@s.whatsapp.net";
  const { upsertWhatsAppContact } = await import("#core/channels/whatsapp/config.js");
  upsertWhatsAppContact(muted, { name: "Acme soporte", role: "contact", auto_reply: false });

  await sendWhatsApp({ session: fakeSession(), globalConfig: readConfig(), to: muted, text: "una sola cosa" });

  const row = findWhatsAppContact(readConfig(), muted);
  assert.equal(row.auto_reply, false, "re-granting a mute on the next send undoes a decision silently");
  assert.equal(policyFor(muted), REPLY_POLICIES.SILENT);
});

test("a group is never vouched for by writing into it", async () => {
  _resetOwnSends();
  await sendWhatsApp({ session: fakeSession(), globalConfig: readConfig(), to: GROUP, text: "buenas" });
  assert.ok(!findWhatsAppContact(readConfig(), GROUP), "one recipient is not consent from the rest");
});

test("a reaction vouches for nobody — it is a mark, not a word", async () => {
  _resetOwnSends();
  const reacted = "5491155550999@s.whatsapp.net";
  await sendWhatsApp({
    session: fakeSession(),
    globalConfig: readConfig(),
    to: reacted,
    reactTo: { id: "ABC", remoteJid: reacted },
    text: "👍",
  });
  assert.equal(policyFor(reacted), REPLY_POLICIES.SILENT);
});

test("choosing an option on a menu vouches too — it is a message we sent", async () => {
  _resetOwnSends();
  offer("buttons");
  await chooseWhatsAppOption({ session: fakeSession(), globalConfig: readConfig(), to: BOT, option: "1" });
  assert.equal(policyFor(BOT), REPLY_POLICIES.TEXT_ONLY);
});

test("a file goes out as a real attachment, and the thread says so", async () => {
  // WhatsApp had no way to SEND a file at all: text, stickers, reactions and
  // button taps. A quote that arrived as a PDF could be read and never passed
  // on — the owner asked for it on their own phone and the answer was a
  // paragraph describing it.
  const s = fakeSession();
  const file = path.join(process.env.APX_HOME, "presupuesto.pdf");
  fs.writeFileSync(file, "%PDF-1.4 fake");

  const r = await sendWhatsApp({
    session: s, globalConfig: config, to: CONTACT, file, text: "acá va",
  });

  assert.equal(r.ok, true);
  assert.equal(r.file, "presupuesto.pdf");
  assert.deepEqual(s.sent.at(-1), {
    kind: "file", jid: CONTACT, path: file,
    opts: { caption: "acá va", fileName: "presupuesto.pdf" },
  });

  // On the ledger like anything else that left, with the path — that is what
  // lets the panel draw the file instead of a line of text about one.
  const row = readGlobalMessages({ channel: CHANNELS.WHATSAPP }).at(-1);
  assert.equal(row.direction, "out");
  assert.match(row.body, /\[file: presupuesto\.pdf\] acá va/);
  assert.equal(row.meta.local_path, file);
  assert.equal(row.meta.media_kind, "document");
});

test("a file with no words is still a message", async () => {
  const s = fakeSession();
  const file = path.join(process.env.APX_HOME, "solo.pdf");
  fs.writeFileSync(file, "%PDF-1.4");
  const r = await sendWhatsApp({ session: s, globalConfig: config, to: CONTACT, file });
  assert.equal(r.sent, true);
  assert.equal(readGlobalMessages({ channel: CHANNELS.WHATSAPP }).at(-1).body, "[file: solo.pdf]");
});

test("forwarding a file does not put our storage prefix on somebody's phone", async () => {
  // An inbound file is saved as `wa-<ts>-<rand>-<their name>` so two people
  // sending "presupuesto.pdf" do not overwrite each other. That is bookkeeping,
  // and it went out on the wire: the owner got their own quote back called
  // `wa-1789059795089-oglgdk-Cotizacion….pdf`.
  const s = fakeSession();
  const file = path.join(process.env.APX_HOME, "wa-1789059795089-oglgdk-Cotizacion.pdf");
  fs.writeFileSync(file, "%PDF-1.4");

  const r = await sendWhatsApp({ session: s, globalConfig: config, to: CONTACT, file });
  assert.equal(r.file, "Cotizacion.pdf");
  assert.equal(s.sent.at(-1).opts.fileName, "Cotizacion.pdf");
  // The PATH is untouched — the file on disk keeps the name that makes it
  // unique; only what the recipient reads is cleaned.
  assert.equal(s.sent.at(-1).path, file);
});
