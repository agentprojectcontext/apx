// Reading WhatsApp history from the agent's side.
//
// Regression: asked "what did <contact> say on WhatsApp?", the super-agent
// answered that it could not read the chat. The rows were on disk — WhatsApp is
// a GLOBAL channel, written to ~/.apx/messages/whatsapp/ — but `tail_messages`
// and `search_messages` only ever opened the project ledger, and nothing else
// exposed a thread read-only. The channel prompt and the apx-whatsapp skill
// already told the agent to use `tail_messages` on channel whatsapp; the tool
// just never looked there.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-history-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const tail = (await import("#core/agent/tools/handlers/tail-messages.js")).default;
const search = (await import("#core/agent/tools/handlers/search-messages.js")).default;
const contacts = (await import("#core/agent/tools/handlers/whatsapp-contacts.js")).default;
const { appendGlobalMessage, appendMessageToFs } = await import("#core/stores/messages.js");
const { upsertWhatsAppContact } = await import("#core/channels/whatsapp/config.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");

const OWNER = "5491155550000@s.whatsapp.net";
const RODRI = "5491166661234@s.whatsapp.net";
const RODRI_LID = "104900000000001@lid";
const ANA = "5491177772222@s.whatsapp.net";
const STRANGER = "5491188883333@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";

const PROJECT_ROOT = path.join(TMP_HOME, "acme");
const projects = {
  current: () => ({ id: 1, name: "acme", path: PROJECT_ROOT }),
  get: () => null,
  list: () => [],
};

let asked;
const tailH = () => tail.makeHandler({ projects });
const searchH = () => search.makeHandler({ projects });
const contactsH = () =>
  contacts.makeHandler({ requirePermission: async (name) => { asked.push(name); } });

function wa({ ts, direction, body, chat, sender = chat, key, author = null, type }) {
  appendGlobalMessage({
    channel: "whatsapp",
    direction,
    type: type || (direction === "in" ? "user" : "agent"),
    author,
    body,
    ts,
    meta: { chat_jid: chat, sender_jid: sender, ...(key ? { contact_key: key } : {}) },
  });
}

beforeEach(() => {
  fs.rmSync(path.join(process.env.APX_HOME, "messages"), { recursive: true, force: true });
  fs.rmSync(PROJECT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  const cfg = readConfig();
  cfg.whatsapp = { owner_jid: OWNER, auto_reply: true, contacts: [], roles: {} };
  writeConfig(cfg);
  upsertWhatsAppContact(RODRI, { name: "Rodrigo Márquez", role: "contact" });
  // The LID is the same human: a learned alias on his roster row.
  const c = readConfig();
  c.whatsapp.contacts.find((r) => r.jid === RODRI).alts = [RODRI_LID];
  writeConfig(c);
  upsertWhatsAppContact(ANA, { name: "Ana Rodríguez", role: "contact" });
  asked = [];

  // Rodrigo, first over his LID, days later over his phone number.
  wa({ ts: "2026-01-10T10:00:00Z", direction: "in", body: "hola, te paso el presupuesto", chat: RODRI_LID, key: RODRI, author: "Rodrigo" });
  wa({ ts: "2026-01-10T10:01:00Z", direction: "out", body: "dale, gracias", chat: RODRI_LID, key: RODRI });
  wa({ ts: "2026-01-10T10:01:05Z", direction: "out", body: "send_whatsapp ok", chat: RODRI_LID, key: RODRI, type: "tool" });
  // Rows written before contact_key existed still belong to him by address.
  wa({ ts: "2026-01-12T09:00:00Z", direction: "in", body: "el presupuesto final es 1200", chat: RODRI, author: "Rodrigo" });
  // Rodrigo speaking in a group.
  wa({ ts: "2026-01-12T11:00:00Z", direction: "in", body: "en el grupo: llego tarde", chat: GROUP, sender: RODRI_LID, author: "Rodrigo" });
  // Other people on the same line and the same days.
  wa({ ts: "2026-01-10T12:00:00Z", direction: "in", body: "Ana acá, presupuesto aparte", chat: ANA, key: ANA, author: "Ana" });
  wa({ ts: "2026-01-11T08:00:00Z", direction: "in", body: "soy nuevo, me pasaron tu número", chat: STRANGER, key: STRANGER, author: "Julián Pérez" });
  wa({ ts: "2026-01-11T09:00:00Z", direction: "in", body: "recordame el presupuesto", chat: OWNER, key: "owner", author: "Owner" });
});

test("tail_messages on channel whatsapp reads the WhatsApp line, not the project ledger", async () => {
  const out = await tailH()({ channel: "whatsapp", limit: 50 });
  assert.equal(out.ok, true);
  assert.equal(out.count, 7, "every conversation row on the line, tool rows excluded");
  assert.ok(out.messages.every((m) => !/send_whatsapp ok/.test(m.body)));
  assert.deepEqual(out.messages.map((m) => m.ts), [...out.messages.map((m) => m.ts)].sort(), "oldest first");
});

test("a contact by name returns every address that person used — and nobody else", async () => {
  const out = await tailH()({ contact: "rodrigo marquez" });
  assert.equal(out.contact.name, "Rodrigo Márquez");
  assert.deepEqual(out.messages.map((m) => m.body), [
    "hola, te paso el presupuesto",
    "dale, gracias",
    "el presupuesto final es 1200",
    "en el grupo: llego tarde",
  ]);
  assert.equal(out.messages[1].from, "me");
  assert.equal(out.messages[3].group, GROUP, "a group line says it came from a group");

  const byNumber = await tailH()({ contact: "+54 9 11 6666-1234", limit: 2 });
  assert.deepEqual(byNumber.messages.map((m) => m.body), ["el presupuesto final es 1200", "en el grupo: llego tarde"]);
});

test("a name that matches two people asks instead of guessing", async () => {
  const out = await tailH()({ contact: "rodr" });
  assert.equal(out.ok, false);
  assert.equal(out.candidates.length, 2);
});

test("somebody who never made the roster is found by the name they wrote in with", async () => {
  const out = await tailH()({ contact: "julian" });
  assert.equal(out.count, 1);
  assert.equal(out.messages[0].from, "Julián Pérez");
});

test("search_messages finds WhatsApp and Telegram rows next to the project's own", async () => {
  appendGlobalMessage({ channel: "telegram", direction: "in", type: "user", body: "mirá el presupuesto de Rodrigo", ts: "2026-01-13T10:00:00Z" });
  appendGlobalMessage({ channel: "discord", direction: "in", type: "user", body: "presupuesto gratis acá", ts: "2026-01-13T11:00:00Z" });
  appendMessageToFs({ projectRoot: PROJECT_ROOT, channel: "a2a", direction: "out", type: "agent", body: "presupuesto armado", ts: "2026-01-09T10:00:00Z" });

  const all = await searchH()({ query: "presupuesto" });
  const channels = new Set(all.map((m) => m.channel));
  assert.ok(channels.has("whatsapp"), "WhatsApp is searchable");
  assert.ok(channels.has("telegram"), "so is Telegram");
  assert.ok(channels.has("a2a"), "and the project ledger still is");
  assert.ok(!channels.has("discord"), "a public room is not the owner's history unless asked for");
  assert.equal(all[0].channel, "telegram", "newest first");

  const onlyRodrigo = await searchH()({ query: "PRESUPUESTO", contact: "Márquez" });
  assert.deepEqual(onlyRodrigo.messages.map((m) => m.body), ["hola, te paso el presupuesto", "el presupuesto final es 1200"]);

  const onlyDiscord = await searchH()({ query: "presupuesto", channel: "discord" });
  assert.equal(onlyDiscord.length, 1, "named explicitly, a public channel is searchable");
});

test("whatsapp_contacts thread reads a conversation without asking permission", async () => {
  const out = await contactsH()({ action: "thread", query: "Ana" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.messages.map((m) => m.body), ["Ana acá, presupuesto aparte"]);
  assert.deepEqual(asked, [], "reading is free — only save/forget stop for a yes");

  const owner = await contactsH()({ action: "thread", query: "owner" });
  assert.deepEqual(owner.messages.map((m) => m.body), ["recordame el presupuesto"]);

  await assert.rejects(() => contactsH()({ action: "thread" }), /needs a query/);
});
