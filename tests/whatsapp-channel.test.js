// The WhatsApp channel's config surface and the rules that hang off it.
//
// The roster is the allowlist, so its edit path is a security boundary too: a
// role that grants more than it should, or an owner that can be assigned by
// editing a contact row, would undo the containment the prompt work bought.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-chan-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  readWhatsAppConfig, patchWhatsAppConfig, listWhatsAppContacts,
  upsertWhatsAppContact, removeWhatsAppContact, setWhatsAppRole, removeWhatsAppRole,
} = await import("#core/channels/whatsapp/config.js");
const { hasWhatsAppCredentials, whatsappAuthDir, SESSION_STATES, loadBaileys } =
  await import("#core/channels/whatsapp/session.js");
const { resolveReplyPolicy, resolveWhatsAppSender, REPLY_POLICIES } =
  await import("#core/identity/whatsapp.js");
const { readConfig } = await import("#core/config/index.js");

const CARLA = "5491166666666@s.whatsapp.net";

test("defaults are the safe ones: on, but answering nobody who isn't listed", () => {
  const wa = readWhatsAppConfig({});
  assert.equal(wa.reply_to_groups, false, "groups off by default");
  assert.deepEqual(wa.contacts, [], "nobody is trusted out of the box");
  assert.equal(wa.owner_jid, "", "no owner until a phone is paired");
});

test("a phone number typed in settings is stored as a JID", () => {
  const wa = patchWhatsAppConfig({ owner_jid: "+54 9 11 5555-5555" });
  assert.equal(wa.owner_jid, "5491155555555@s.whatsapp.net");
});

test("a contact starts as a guest — which is to say, unanswered", () => {
  upsertWhatsAppContact(CARLA, { name: "Carla" });
  const cfg = readConfig();
  const sender = resolveWhatsAppSender({ cfg, senderJid: CARLA });
  assert.equal(sender.role, "guest");
  assert.equal(resolveReplyPolicy(cfg, sender), REPLY_POLICIES.SILENT);

  upsertWhatsAppContact(CARLA, { role: "contact" });
  const cfg2 = readConfig();
  assert.equal(
    resolveReplyPolicy(cfg2, resolveWhatsAppSender({ cfg: cfg2, senderJid: CARLA })),
    REPLY_POLICIES.TEXT_ONLY
  );
});

test("the roster cannot hand out ownership", () => {
  // Owner is whoever paired. If a contact row could claim it, the one identity
  // every containment decision rests on would be editable from a text field.
  assert.throws(() => upsertWhatsAppContact(CARLA, { role: "owner" }), /pairing/i);
});

test("an unknown role is refused at the edit, not silently at read time", () => {
  // Storing "conctact" would resolve to silence forever and look like a broken
  // socket. Failing here names the actual problem.
  assert.throws(() => upsertWhatsAppContact(CARLA, { role: "conctact" }), /unknown role/i);

  setWhatsAppRole("cliente", { auto_reply: true });
  upsertWhatsAppContact(CARLA, { role: "cliente" });
  const cfg = readConfig();
  assert.equal(
    resolveReplyPolicy(cfg, resolveWhatsAppSender({ cfg, senderJid: CARLA })),
    REPLY_POLICIES.TEXT_ONLY
  );
  assert.ok(removeWhatsAppRole("cliente"));
});

test("a phone number and its JID address the same contact row", () => {
  const before = listWhatsAppContacts().length;
  upsertWhatsAppContact("+54 9 11 6666-6666", { note: "la vecina" });
  assert.equal(listWhatsAppContacts().length, before, "no duplicate row");
  assert.equal(listWhatsAppContacts().find((c) => c.jid === CARLA)?.note, "la vecina");
});

test("removing a contact removes the permission with it", () => {
  assert.ok(removeWhatsAppContact(CARLA));
  const cfg = readConfig();
  assert.equal(
    resolveReplyPolicy(cfg, resolveWhatsAppSender({ cfg, senderJid: CARLA })),
    REPLY_POLICIES.SILENT
  );
});

test("with no credentials the daemon stays idle instead of demanding a QR", () => {
  assert.equal(hasWhatsAppCredentials(), false);
  fs.writeFileSync(path.join(whatsappAuthDir(), "creds.json"), "{}");
  assert.equal(hasWhatsAppCredentials(), true, "…and comes back by itself once paired");
});

test("the optional dependency is present and exposes what the session needs", async () => {
  const b = await loadBaileys();
  if (!b) return; // an install without the optional dep: the feature is off, not broken
  for (const fn of ["makeWASocket", "useMultiFileAuthState", "downloadMediaMessage", "DisconnectReason"]) {
    assert.ok(b[fn], `baileys is missing ${fn}`);
  }
  assert.equal(SESSION_STATES.CONNECTED, "connected");
});

// ── the 515 that made the owner never get recorded ─────────────────────────

test("the connected account is announced on every connection, not only after a QR", async () => {
  // The regression: a fresh QR pairing does NOT end with the socket opening.
  // WhatsApp ends it with `stream:error 515` (restart required) and the
  // credentials only come up on the reconnect after it. So the connection that
  // succeeds is never the one that was in `pairing` state, and the original
  // `if (wasPairing)` guard meant nothing was ever recorded — observed live on
  // 2026-09-08 with a real phone.
  //
  // Asserted on the source because the alternative is a live WhatsApp socket in
  // the suite: what matters is that the announcement is NOT conditional on the
  // pairing state.
  const src = fs.readFileSync("src/core/channels/whatsapp/session.js", "utf8");
  const openBranch = src.slice(src.indexOf('u.connection === "open"'), src.indexOf('u.connection === "close"'));
  assert.match(openBranch, /if \(me\) onIdentified\(me\)/,
    "must fire on any successful connection");
  assert.doesNotMatch(openBranch, /wasPairing/,
    "gating on the pairing state is the bug: a 515 restart lands outside it");
});

test("what connects is recorded as the LINE, never guessed to be the owner", () => {
  // The second half of the same bug, and the worse half. "Owner = whoever
  // paired" made a dedicated assistant line the owner of itself, which left the
  // actual human a stranger on it — answered with silence on their own number.
  // The software cannot deduce which person is behind a line, so it records the
  // line and asks about the person.
  const plugin = fs.readFileSync("src/host/daemon/plugins/whatsapp/index.js", "utf8");
  assert.match(plugin, /patchWhatsAppConfig\(\{ self_jid: jid \}\)/, "records the line");
  assert.doesNotMatch(plugin, /owner_jid: jid/, "must not assign ownership from a connection");
});

// ── the contact as a person, not just a permission ─────────────────────────

test("what the owner writes about one contact reaches that contact's turn only", async () => {
  const { buildWhatsAppRelationshipBlock } = await import("#core/channels/whatsapp/relationship.js");
  const { resolveWhatsAppSender } = await import("#core/identity/whatsapp.js");

  const MAGUI = "5491177777777@s.whatsapp.net";
  const PLOMERO = "5491188888888@s.whatsapp.net";
  upsertWhatsAppContact(MAGUI, {
    name: "Margarita", nickname: "Magui", relationship: "partner", role: "contact",
    bio: "es mi esposa y vivo con ella",
    rules: "podés contestarle siempre sin límite; avisame solo cuando haya algo que yo tenga que saber",
  });
  upsertWhatsAppContact(PLOMERO, { name: "Julio", role: "contact" });

  const cfg = readConfig();
  const hers = buildWhatsAppRelationshipBlock(resolveWhatsAppSender({ cfg, senderJid: MAGUI }), cfg);
  assert.match(hers, /Magui/);
  assert.match(hers, /their partner/);
  assert.match(hers, /sin límite/);

  // The whole point of per-contact fields: the plumber's turn knows nothing
  // about the owner's wife. A shared "about the owner" block would leak by
  // default; this one cannot, because it is built from one roster row.
  const his = buildWhatsAppRelationshipBlock(resolveWhatsAppSender({ cfg, senderJid: PLOMERO }), cfg);
  assert.match(his, /Julio/);
  assert.ok(!his.includes("esposa"), "one contact's details must not appear in another's prompt");
  assert.ok(!his.includes("Magui"));
});

test("a generous rule cannot conjure facts the turn does not have", () => {
  // "Answer her about anything" is the owner widening TONE. The turn still has
  // no tools and no memory, so the prompt has to say that plainly or the model
  // reads a warm rule as licence to invent what it would need to honour it.
  const cfg = readConfig();
  const block = (async () => {
    const { buildWhatsAppRelationshipBlock } = await import("#core/channels/whatsapp/relationship.js");
    const { resolveWhatsAppSender } = await import("#core/identity/whatsapp.js");
    return buildWhatsAppRelationshipBlock(
      resolveWhatsAppSender({ cfg, senderJid: "5491177777777@s.whatsapp.net" }), cfg);
  })();
  return block.then((b) => {
    assert.match(b, /does not give you facts you do not have/i);
    assert.match(b, /you still do not know it/i);
  });
});

test("the shared rule: don't assume — say you're checking", async () => {
  const { buildThirdPartySystem } = await import("#core/agent/prompt-builder.js");
  const { CHANNELS } = await import("#core/constants/channels.js");
  const sys = buildThirdPartySystem({ globalConfig: {}, channel: CHANNELS.WHATSAPP });
  assert.match(sys, /say you are checking/i);
  // The specific things it must never settle alone.
  for (const w of [/prices/i, /dates/i, /whether your owner agrees/i]) assert.match(sys, w);
  // And it must not offer to arrange the escalation — that already happened.
  assert.match(sys, /told about this conversation automatically/i);
});

// ── "This is me": promoting a row to owner ─────────────────────────────────

test("promoting a contact makes them the owner, whatever address they arrived under", async () => {
  const { promoteToOwner, clearOwner, resolveWhatsAppSender, resolveReplyPolicy: policy, REPLY_POLICIES: P } =
    await import("#core/identity/whatsapp.js");

  clearOwner(readConfig());
  // Arrives as a LID — an address that appears nowhere in WhatsApp, so it could
  // never have been typed into a settings field. This is the whole reason the
  // promote button exists.
  const LID = "101666238013462@lid";
  upsertWhatsAppContact(LID, { name: "Manu" });
  const cfg0 = readConfig();
  assert.ok(!resolveWhatsAppSender({ cfg: cfg0, senderJid: LID }).isOwner);

  const r = promoteToOwner(cfg0, LID);
  assert.equal(r.owner_jid, LID);

  const cfg1 = readConfig();
  const s = resolveWhatsAppSender({ cfg: cfg1, senderJid: LID });
  assert.ok(s.isOwner);
  assert.equal(policy(cfg1, s), P.FULL);
  // The row survives. Deleting it made the button look like it had erased the
  // person — no undo, and nowhere to check what had actually been recorded.
  assert.ok(listWhatsAppContacts().find((c) => c.jid === LID), "the contact row stays");
});

test("promoting a second address keeps the first as an alias", async () => {
  const { promoteToOwner, resolveWhatsAppSender } = await import("#core/identity/whatsapp.js");
  const PHONE = "5492944636430@s.whatsapp.net";
  upsertWhatsAppContact(PHONE, { name: "Manu (otro tel)" });
  promoteToOwner(readConfig(), PHONE);

  const cfg = readConfig();
  // Two phones is "this is me too", not "that other one was a mistake".
  assert.ok(resolveWhatsAppSender({ cfg, senderJid: PHONE }).isOwner);
  assert.ok(resolveWhatsAppSender({ cfg, senderJid: "101666238013462@lid" }).isOwner);
});

test("clearing the owner leaves the roster alone", async () => {
  const { clearOwner } = await import("#core/identity/whatsapp.js");
  upsertWhatsAppContact("5491133333333@s.whatsapp.net", { name: "Alguien", role: "contact" });
  const before = listWhatsAppContacts().length;
  clearOwner(readConfig());
  assert.equal(readWhatsAppConfig().owner_jid, "");
  assert.equal(listWhatsAppContacts().length, before, "contacts are not collateral");
});

// ── relationship as a closed list ──────────────────────────────────────────

test("relationship is a category, and free text is refused with the options", async () => {
  const { RELATIONSHIPS } = await import("#core/channels/whatsapp/relationships.js");
  const JID = "5491144444444@s.whatsapp.net";
  upsertWhatsAppContact(JID, { name: "Alguien", role: "contact" });

  // "esposa de Manu" is a sentence, and a sentence belongs in `bio` — where it
  // was ALSO being written, which is how the two fields came to say the same
  // thing twice in the same prompt.
  assert.throws(() => upsertWhatsAppContact(JID, { relationship: "esposa de Manu" }), /unknown relationship/);
  // The error names the options, so an agent writing through the API learns
  // them instead of guessing a second time.
  try { upsertWhatsAppContact(JID, { relationship: "esposo" }); } catch (e) {
    for (const r of ["partner", "family", "friend"]) assert.match(e.message, new RegExp(r));
  }

  upsertWhatsAppContact(JID, { relationship: "partner" });
  assert.equal(listWhatsAppContacts().find((c) => c.jid === JID).relationship, "partner");
  assert.ok(RELATIONSHIPS.includes("partner"));

  // Clearing is allowed — not every contact has a category.
  upsertWhatsAppContact(JID, { relationship: "" });
  assert.equal(listWhatsAppContacts().find((c) => c.jid === JID).relationship, "");
});

test("the prompt gets a phrase, never the slug", async () => {
  const { buildWhatsAppRelationshipBlock } = await import("#core/channels/whatsapp/relationship.js");
  const { resolveWhatsAppSender } = await import("#core/identity/whatsapp.js");
  const JID = "5491144444444@s.whatsapp.net";
  upsertWhatsAppContact(JID, { name: "Alguien", relationship: "business_partner" });

  const cfg = readConfig();
  const block = buildWhatsAppRelationshipBlock(resolveWhatsAppSender({ cfg, senderJid: JID }), cfg);
  assert.match(block, /a business partner/, "the model reads English prose…");
  assert.ok(!block.includes("business_partner"), "…not the stored slug");
});

test("a rejected field leaves nothing half-written behind", () => {
  // The row used to be pushed into the config BEFORE the fields were checked,
  // so a bad value threw with a nameless contact already in the in-memory
  // object — invisible on disk, and read back as a stranger by anything still
  // holding it. Validation now happens first.
  const JID = "5491155551111@s.whatsapp.net";
  const before = listWhatsAppContacts().length;
  assert.throws(() => upsertWhatsAppContact(JID, { name: "Nadie", relationship: "vecino" }), /unknown relationship/);
  assert.equal(listWhatsAppContacts().length, before, "no ghost row on disk");
  assert.equal(readConfig().whatsapp.contacts.find((c) => c.jid === JID), undefined, "nor in the object");
});

// ── capabilities: capture, never act ───────────────────────────────────────

test("every capability is off until the owner turns it on, per contact", async () => {
  const { resolveCapabilities, CAPABILITIES } =
    await import("#core/channels/whatsapp/config.js");
  const JID = "5491122223333@s.whatsapp.net";
  upsertWhatsAppContact(JID, { name: "Cliente", role: "contact" });

  const cfg0 = readConfig();
  const off = resolveCapabilities(cfg0, listWhatsAppContacts().find((c) => c.jid === JID));
  for (const k of CAPABILITIES) {
    assert.equal(off[k], false, `${k} must default to off — "may this stranger schedule something" answers itself`);
  }

  upsertWhatsAppContact(JID, { capabilities: { appointments: true }, facts: "Abrimos 9 a 18." });
  const cfg1 = readConfig();
  const c1 = listWhatsAppContacts().find((x) => x.jid === JID);
  assert.equal(resolveCapabilities(cfg1, c1).appointments, true);
  assert.equal(resolveCapabilities(cfg1, c1).errands, false, "turning one on does not turn the rest on");
});

test("a contact's own setting overrides the global default, including turning it OFF", async () => {
  const { resolveCapabilities, patchWhatsAppConfig: patchCfg } =
    await import("#core/channels/whatsapp/config.js");
  patchCfg({ capabilities: { errands: true } });
  const JID = "5491122224444@s.whatsapp.net";
  upsertWhatsAppContact(JID, { name: "Otro", role: "contact" });

  let cfg = readConfig();
  assert.equal(resolveCapabilities(cfg, listWhatsAppContacts().find((c) => c.jid === JID)).errands, true,
    "inherits the global default");

  upsertWhatsAppContact(JID, { capabilities: { errands: false } });
  cfg = readConfig();
  assert.equal(resolveCapabilities(cfg, listWhatsAppContacts().find((c) => c.jid === JID)).errands, false,
    "an explicit false must beat a true default, not read as 'unset'");
  patchCfg({ capabilities: {} });
});

test("facts reach the prompt as approved answers; without the capability they do not", async () => {
  const { buildWhatsAppRelationshipBlock } = await import("#core/channels/whatsapp/relationship.js");
  const { resolveWhatsAppSender } = await import("#core/identity/whatsapp.js");
  const JID = "5491122225555@s.whatsapp.net";
  upsertWhatsAppContact(JID, { name: "Cliente", role: "contact", facts: "Abrimos de 9 a 18 en Alsina 123." });

  const block = () => buildWhatsAppRelationshipBlock(
    resolveWhatsAppSender({ cfg: readConfig(), senderJid: JID }), readConfig());

  // Written but not enabled: the text is inert. A note the owner typed is not
  // the same as permission to read it out.
  assert.ok(!block().includes("Alsina 123"));

  upsertWhatsAppContact(JID, { capabilities: { facts: true } });
  const b = block();
  assert.match(b, /Alsina 123/);
  // …and the boundary is restated where it is easiest to over-read.
  assert.match(b, /Everything NOT in it is still something you do not know/i);
});

test("an enabled appointment capability tells the turn NOT to confirm anything", async () => {
  const { buildWhatsAppRelationshipBlock } = await import("#core/channels/whatsapp/relationship.js");
  const { resolveWhatsAppSender } = await import("#core/identity/whatsapp.js");
  const JID = "5491122226666@s.whatsapp.net";
  upsertWhatsAppContact(JID, { name: "Cliente", role: "contact", capabilities: { appointments: true } });
  const b = buildWhatsAppRelationshipBlock(
    resolveWhatsAppSender({ cfg: readConfig(), senderJid: JID }), readConfig());
  assert.match(b, /passing it on for confirmation/i);
  assert.match(b, /never say it is booked/i);
  assert.match(b, /never offer a slot as if it were free/i);
});

// ── one message, one answer ─────────────────────────────────────────────────

test("the Tasker bridge is refused while the native session is connected", () => {
  // Both delivered the same WhatsApp message for a while, so every one produced
  // two model turns and two replies — and only the channel's reached the
  // contact. The bridge's landed in the ledger, which is worse than nothing:
  // the owner reads an answer in the panel that was never sent.
  const src = fs.readFileSync("src/host/daemon/api/super-agent.js", "utf8");
  assert.match(src, /function whatsappHandledByChannel/);
  // Guarded on BOTH chat endpoints — the bridge posts to the blocking one, but
  // a guard on one of a pair is a guard somebody will route around by accident.
  const guards = src.match(/whatsappHandledByChannel\(plugins, req\.body\?\.channel\)/g) || [];
  assert.equal(guards.length, 2, "both /chat and /chat/stream must be guarded");
  // The session is the authority, and only while it is actually up: with the
  // socket down the bridge is the transport again and must keep working.
  assert.match(src, /state === "connected"/);
});
