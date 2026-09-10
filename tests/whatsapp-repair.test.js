// Going back over the chats and fixing what was written down wrong.
//
// Every test here fails against the code of 2026-09-10, where all four of these
// were live at once on one install:
//
//   - a company on the roster with an empty name, because a business sends no
//     `pushName` and nothing read `verifiedBizName`;
//   - a conversation APX had OPENED and could not continue, because the roster
//     is fed by inbound messages only and the recipient was still a guest;
//   - a button menu written into the ledger as the marker "[empty message]";
//   - a contact whose message started a turn that a restart killed, leaving
//     them unanswered with nothing anywhere saying so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-repair-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { inspectWhatsAppChats, repairWhatsAppChats } = await import("#core/channels/whatsapp/repair.js");
const { appendGlobalMessage, patchGlobalMessage, readGlobalMessages } = await import("#core/stores/messages.js");
const { learnWhatsAppNames } = await import("#core/identity/whatsapp.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { CHANNELS } = await import("#core/constants/channels.js");

const OWNER = "5491155559999@s.whatsapp.net";
const CONTACT = "5491155550001@s.whatsapp.net";
const COMPANY = "104900000000000@lid";

/** Wipe the ledger and the roster between tests: both are global on disk. */
function reset(contacts = []) {
  const dir = path.join(process.env.APX_HOME, "messages", CHANNELS.WHATSAPP);
  fs.rmSync(dir, { recursive: true, force: true });
  const cfg = readConfig();
  cfg.whatsapp = { owner_jid: OWNER, contacts };
  writeConfig(cfg);
  return cfg;
}

const inbound = (jid, body, meta = {}) =>
  appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "in",
    type: "user",
    actor_id: jid,
    author: meta.author ?? "",
    body,
    external_id: meta.external_id,
    meta: { chat_jid: jid, sender_jid: jid, contact_key: jid, policy: "text_only", ...meta },
  });

const outbound = (jid, body) =>
  appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "out",
    type: "agent",
    actor_id: jid,
    body,
    meta: { chat_jid: jid, sender_jid: jid, contact_key: jid },
  });

test("a guest APX wrote to first is found, and the repair makes them answerable", async () => {
  const cfg = reset([{ jid: COMPANY, name: "", role: "guest", auto_reply: false }]);
  outbound(COMPANY, "Hola, una consulta");

  const found = inspectWhatsAppChats({ cfg });
  assert.equal(found.contacts.filter((c) => c.kind === "unvouched").length, 1);

  await repairWhatsAppChats({ cfg });
  const row = readConfig().whatsapp.contacts.find((c) => c.jid === COMPANY);
  assert.equal(row.role, "contact");
  assert.equal(row.auto_reply, true);
  // Answerable, but NOT vetted: nobody has said who they are, and the row has
  // to carry that difference or it looks curated by hand.
  assert.equal(row.pending_review, true);
});

test("a guest nobody wrote to is left exactly as the owner left them", async () => {
  const cfg = reset([{ jid: CONTACT, name: "Sam", role: "guest", auto_reply: false }]);
  inbound(CONTACT, "hola?", { author: "Sam", policy: "silent", role: "guest" });

  await repairWhatsAppChats({ cfg });
  const row = readConfig().whatsapp.contacts.find((c) => c.jid === CONTACT);
  assert.equal(row.role, "guest");
  assert.equal(row.auto_reply, false);
});

test("a nameless row is named from what the ledger already heard", async () => {
  const cfg = reset([{ jid: CONTACT, name: "", role: "contact", auto_reply: true }]);
  inbound(CONTACT, "buenas", { author: "Northwind Sam" });

  const r = await repairWhatsAppChats({ cfg });
  assert.ok(r.fixed.some((f) => f.action?.includes("Northwind Sam")));
  assert.equal(readConfig().whatsapp.contacts.find((c) => c.jid === CONTACT).name, "Northwind Sam");
});

test("\"unknown\" is not a name and never lands on a row", async () => {
  const cfg = reset([{ jid: CONTACT, name: "", role: "contact", auto_reply: true }]);
  inbound(CONTACT, "buenas", { author: "unknown" });

  await repairWhatsAppChats({ cfg });
  assert.equal(readConfig().whatsapp.contacts.find((c) => c.jid === CONTACT).name, "");
});

test("a message that arrived as [empty message] is asked for again and rewritten", async () => {
  const cfg = reset([{ jid: COMPANY, name: "", role: "contact", auto_reply: true }]);
  inbound(COMPANY, "[empty message]", { external_id: "MSG1", policy: "silent", role: "guest" });

  // The phone still has it: a button menu, which is what the decoder of the day
  // could not read.
  const session = {
    status: () => ({ state: "connected" }),
    async recoverMessage(key) {
      assert.equal(key.id, "MSG1");
      return {
        key,
        verifiedBizName: "Northwind Seguros",
        message: {
          buttonsMessage: {
            contentText: "¿Con qué te ayudo?",
            buttons: [
              { buttonId: "a", buttonText: { displayText: "Autos" } },
              { buttonId: "b", buttonText: { displayText: "Hogar" } },
            ],
          },
        },
      };
    },
  };

  const r = await repairWhatsAppChats({ cfg, session });
  assert.equal(r.connected, true);

  const row = readGlobalMessages({ channel: CHANNELS.WHATSAPP }).find((m) => m.meta?.external_id === "MSG1");
  assert.match(row.body, /¿Con qué te ayudo\?/);
  // The options survive as data, not only as text: the panel draws them as
  // buttons and the agent answers "2" from them.
  assert.equal(row.meta.interactive_options.length, 2);
  assert.equal(row.meta.interactive_options[1].title, "Hogar");
  assert.equal(row.meta.repaired, true);
  // The message that came back is also the answer to "who IS this".
  assert.equal(readConfig().whatsapp.contacts.find((c) => c.jid === COMPANY).name, "Northwind Seguros");
});

test("a phone that does not answer costs nothing but a counter", async () => {
  const cfg = reset([{ jid: COMPANY, name: "x", role: "contact", auto_reply: true }]);
  inbound(COMPANY, "[empty message]", { external_id: "MSG2" });

  const session = { status: () => ({ state: "connected" }), async recoverMessage() { return null; } };
  const r = await repairWhatsAppChats({ cfg, session });

  assert.ok(r.left.some((l) => l.why?.includes("did not send it back")));
  const row = readGlobalMessages({ channel: CHANNELS.WHATSAPP }).find((m) => m.meta?.external_id === "MSG2");
  assert.equal(row.body, "[empty message]");       // untouched: we know nothing new
  assert.equal(row.meta.recover_attempts, 1);
});

test("with the socket down the roster is still repaired, and it says what it could not do", async () => {
  const cfg = reset([{ jid: COMPANY, name: "", role: "guest", auto_reply: false }]);
  outbound(COMPANY, "hola");
  inbound(COMPANY, "[empty message]", { external_id: "MSG3" });

  const r = await repairWhatsAppChats({ cfg, session: null });
  assert.equal(r.connected, false);
  assert.equal(readConfig().whatsapp.contacts.find((c) => c.jid === COMPANY).role, "contact");
  assert.ok(r.left.some((l) => l.why?.includes("not connected")));
});

test("a dry run reports the same list and changes nothing", async () => {
  const cfg = reset([{ jid: COMPANY, name: "", role: "guest", auto_reply: false }]);
  outbound(COMPANY, "hola");

  const r = await repairWhatsAppChats({ cfg, dryRun: true });
  assert.equal(r.dry_run, true);
  assert.ok(r.fixed.length >= 1);
  assert.equal(readConfig().whatsapp.contacts.find((c) => c.jid === COMPANY).role, "guest");
});

test("a contact left hanging is reported — and never answered automatically", async () => {
  const cfg = reset([{ jid: CONTACT, name: "Sam", nickname: "Sam", role: "contact", auto_reply: true }]);
  outbound(CONTACT, "buenas");
  inbound(CONTACT, "¿me pasás la dirección?", { author: "Sam" });

  const found = inspectWhatsAppChats({ cfg });
  const hanging = found.messages.filter((m) => m.kind === "unanswered");
  assert.equal(hanging.length, 1);
  assert.equal(hanging[0].name, "Sam");
  assert.match(hanging[0].text, /dirección/);

  const r = await repairWhatsAppChats({ cfg });
  // Reported as left, never fixed: writing to somebody is not a repair's call.
  assert.ok(r.left.some((l) => l.kind === "unanswered"));
});

test("a stranger met with silence, and a reaction, are not 'unanswered'", async () => {
  reset([{ jid: CONTACT, name: "Sam", role: "guest", auto_reply: false }]);
  inbound(CONTACT, "hola", { policy: "silent", role: "guest" });
  const cfg2 = readConfig();
  cfg2.whatsapp.contacts = [{ jid: COMPANY, name: "N", role: "contact", auto_reply: true }];
  writeConfig(cfg2);
  inbound(COMPANY, "[reaccionó 👍]", { media_kind: "reaction" });

  const found = inspectWhatsAppChats({ cfg: readConfig() });
  assert.equal(found.messages.filter((m) => m.kind === "unanswered").length, 0);
});

test("the ledger row is matched by the channel's own message id, and nothing else moves", async () => {
  reset([]);
  inbound(CONTACT, "original", { external_id: "MSG9" });
  const before = readGlobalMessages({ channel: CHANNELS.WHATSAPP }).find((m) => m.meta?.external_id === "MSG9");

  const after = patchGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    date: before.ts,
    external_id: "MSG9",
    body: "recovered",
    meta: { repaired: true },
  });
  assert.equal(after.body, "recovered");
  assert.equal(after.ts, before.ts);
  assert.equal(after.direction, "in");
  assert.equal(after.meta.chat_jid, CONTACT);      // the rest of the meta survives
  assert.equal(patchGlobalMessage({ channel: CHANNELS.WHATSAPP, date: before.ts, external_id: "NOPE" }), null);
});

test("WhatsApp's own names fill an empty row and never overwrite the owner's", async () => {
  const cfg = reset([
    { jid: COMPANY, name: "", role: "contact", auto_reply: true },
    { jid: CONTACT, name: "What Manu typed", role: "contact", auto_reply: true },
  ]);

  const learned = learnWhatsAppNames(cfg, [
    { id: COMPANY, verifiedName: "Northwind Seguros" },
    { id: CONTACT, name: "Whatever the phone book says" },
  ]);

  assert.equal(learned, 1);
  const rows = readConfig().whatsapp.contacts;
  assert.equal(rows.find((c) => c.jid === COMPANY).name, "Northwind Seguros");
  assert.equal(rows.find((c) => c.jid === COMPANY).business, true);
  assert.equal(rows.find((c) => c.jid === CONTACT).name, "What Manu typed");
});
