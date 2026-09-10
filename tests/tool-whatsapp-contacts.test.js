// The whatsapp_contacts tool — the roster, from the agent's side.
//
// Why it exists: the roster is the allowlist that decides whose messages are
// answered, and the only ways to change it were the panel and the HTTP API. So
// the agent could be told "buscá el número de Rodrigo y activale los mensajes",
// could see him in the ledger, and could do nothing but tell the owner to go
// and click. Reading is free here; granting somebody a standing conversation
// stops for permission.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-contacts-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const tool = (await import("#core/agent/tools/handlers/whatsapp-contacts.js")).default;
const { upsertWhatsAppContact, patchWhatsAppConfig } = await import("#core/channels/whatsapp/config.js");
const { vouchWhatsAppRecipient } = await import("#core/identity/whatsapp.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");

const OWNER = "5491155550000@s.whatsapp.net";
const RODRI = "5491166661234@s.whatsapp.net";
const BIZ = "104900000000000@lid";

let asked, handler;

beforeEach(() => {
  const cfg = readConfig();
  cfg.whatsapp = { owner_jid: OWNER, auto_reply: true, contacts: [], roles: {} };
  writeConfig(cfg);
  asked = [];
  handler = tool.makeHandler({
    requirePermission: async (name, opts) => { asked.push({ name, ...opts, ...(opts?.args || {}) }); },
  });
});

test("find locates somebody by name, by nickname and by a loosely typed number", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo Márquez", nickname: "Rodri", role: "contact" });

  assert.equal((await handler({ action: "find", query: "rodrigo" })).count, 1);
  assert.equal((await handler({ action: "find", query: "RODRI" })).count, 1, "nickname, case-insensitively");
  assert.equal((await handler({ action: "find", query: "Márquez" })).count, 1);
  assert.equal((await handler({ action: "find", query: "marquez" })).count, 1, "accents must not hide a row");

  // The owner types a number the way a person writes one, never as a JID.
  const byNumber = await handler({ action: "find", query: "+54 9 11 6666-1234" });
  assert.equal(byNumber.count, 1, "this is what 'buscá el número de Rodrigo' actually looks like");
  assert.equal(byNumber.contacts[0].jid, RODRI);

  assert.equal((await handler({ action: "find", query: "nadie" })).count, 0);
});

test("every row says whether that person actually gets answered", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo", role: "contact" });
  upsertWhatsAppContact("5491177770000@s.whatsapp.net", { name: "Desconocido", role: "guest" });

  const rows = (await handler({ action: "list" })).contacts;
  const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
  // The role alone does not answer the question — auto_reply, the role table
  // and the master switch all get a vote. Resolving it here means the agent
  // never has to reconstruct the policy from parts.
  assert.equal(by.Rodrigo, "answered");
  assert.equal(by.Desconocido, "silent");
});

test("list pending shows only the ones APX added by writing to them", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo", role: "contact" });
  vouchWhatsAppRecipient(readConfig(), BIZ, { name: "Northwind Seguros" });

  const pending = await handler({ action: "list", pending: true });
  assert.equal(pending.count, 1);
  assert.equal(pending.contacts[0].jid, BIZ);
  assert.equal(pending.contacts[0].pending_review, true);
  assert.equal(pending.total, 2, "…out of everyone on the roster");
});

test("saving a role asks first, and says WHAT is being granted", async () => {
  const r = await handler({ action: "save", jid: "+54 9 11 6666-1234", name: "Rodrigo", role: "contact" });

  assert.equal(asked.length, 1, "a standing grant is not a silent write");
  assert.match(asked[0].change, /role → contact/);
  assert.match(asked[0].change, /name → Rodrigo/);
  assert.equal(r.created, true);
  assert.equal(r.contact.status, "answered", "and it took effect — this is 'activale los mensajes'");
});

test("muting one person keeps them on the roster", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo", role: "contact" });
  const r = await handler({ action: "save", jid: RODRI, auto_reply: false });
  assert.match(asked[0].change, /muted/);
  assert.equal(r.contact.status, "silent");
  assert.equal((await handler({ action: "find", query: "rodrigo" })).count, 1, "muted, not forgotten");
});

test("touching a row IS reviewing it", async () => {
  vouchWhatsAppRecipient(readConfig(), BIZ, { name: "Northwind Seguros" });
  assert.equal((await handler({ action: "list", pending: true })).count, 1);

  await handler({ action: "save", jid: BIZ, bio: "el bot de mi seguro" });
  assert.equal((await handler({ action: "list", pending: true })).count, 0);
});

test("owner cannot be granted from here — it is decided by pairing", async () => {
  await assert.rejects(
    () => handler({ action: "save", jid: RODRI, role: "owner" }),
    /owner is set by pairing/
  );
});

test("forget takes them off the allowlist without erasing the conversation", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo", role: "contact" });
  const r = await handler({ action: "forget", jid: RODRI });
  assert.equal(asked.length, 1, "removing somebody is a decision too");
  assert.match(r.note, /history is untouched/);
  assert.equal((await handler({ action: "find", query: "rodrigo" })).count, 0);

  const missing = await handler({ action: "forget", jid: "5491100000000@s.whatsapp.net" });
  assert.equal(missing.ok, false, "a miss is information, not a crash");
});

test("a save with nothing to change, and a bad address, are refused before anything is written", async () => {
  await assert.rejects(() => handler({ action: "save", jid: RODRI }), /needs something to change/);
  await assert.rejects(() => handler({ action: "save", jid: "no es un numero", role: "contact" }), /not a usable/);
  await assert.rejects(() => handler({ action: "find" }), /needs a query/);
  await assert.rejects(() => handler({ action: "bailar" }), /unknown action/);
  assert.equal(asked.length, 0, "nothing was even asked about");
});

test("it reads from disk, so a role changed in the panel is honoured on the next call", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo", role: "guest" });
  assert.equal((await handler({ action: "find", query: "rodrigo" })).contacts[0].status, "silent");

  // The panel writes straight to config.json; the turn's own copy is stale.
  upsertWhatsAppContact(RODRI, { role: "contact" });
  assert.equal((await handler({ action: "find", query: "rodrigo" })).contacts[0].status, "answered");
});

test("the master switch is visible in the status, not hidden behind the role", async () => {
  upsertWhatsAppContact(RODRI, { name: "Rodrigo", role: "contact" });
  patchWhatsAppConfig({ auto_reply: false });
  assert.equal(
    (await handler({ action: "find", query: "rodrigo" })).contacts[0].status,
    "silent",
    "auto_reply off means nobody is answered, whatever their role says"
  );
});
