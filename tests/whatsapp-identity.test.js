// Who the owner is, and who gets answered at all.
//
// Both decisions are security decisions on this channel: the owner's number is
// public to everyone who has ever had it, so "unknown sender" is the normal
// case and not an edge one. Every test below is written from the direction of
// the failure — a lookalike number resolving to the owner, a stranger getting a
// reply, being recorded quietly turning into being trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-id-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  normalizeJid,
  isGroupJid,
  resolveWhatsAppSender,
  resolveReplyPolicy,
  registerWhatsAppSender,
  REPLY_POLICIES,
} = await import("#core/identity/whatsapp.js");

const OWNER = "5491155555555@s.whatsapp.net";
const CARLA = "5491166666666@s.whatsapp.net";
const STRANGER = "5491199999999@s.whatsapp.net";

function cfg(extra = {}) {
  return {
    whatsapp: {
      enabled: true,
      owner_jid: OWNER,
      contacts: [{ jid: CARLA, name: "Carla", role: "contact", auto_reply: true }],
      ...extra,
    },
  };
}

const sender = (c, senderJid, opts = {}) =>
  resolveWhatsAppSender({ cfg: c, senderJid, ...opts });

// ── normalizeJid ───────────────────────────────────────────────────────────

test("normalizeJid: the forms of one number all compare equal", () => {
  const want = "5491155555555@s.whatsapp.net";
  assert.equal(normalizeJid("+54 9 11 5555-5555"), want);
  assert.equal(normalizeJid("5491155555555"), want);
  assert.equal(normalizeJid(OWNER), want);
  // The per-device suffix varies with every linked device and must not split
  // one account into several identities.
  assert.equal(normalizeJid("5491155555555:12@s.whatsapp.net"), want);
});

test("normalizeJid: unparseable input is null, never a lucky match", () => {
  for (const bad of [null, undefined, "", "   ", "hola", "123", "@s.whatsapp.net"]) {
    assert.equal(normalizeJid(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("normalizeJid: keeps the domain, so a group is never a person", () => {
  assert.equal(normalizeJid("120363000000000000@g.us"), "120363000000000000@g.us");
  assert.ok(isGroupJid("120363000000000000@g.us"));
  assert.ok(!isGroupJid(OWNER));
});

// ── owner resolution ───────────────────────────────────────────────────────

test("the owner is one exact address, in any written form", () => {
  const c = cfg();
  assert.ok(sender(c, OWNER).isOwner);
  assert.ok(sender(c, "+54 9 11 5555-5555").isOwner);
  assert.ok(sender(c, "5491155555555:3@s.whatsapp.net").isOwner);
});

test("a lookalike number is NOT the owner", () => {
  const c = cfg();
  // Prefix, suffix and one-digit-off: each would pass a sloppier comparison.
  for (const impostor of [
    "549115555555@s.whatsapp.net",      // one digit short
    "54911555555550@s.whatsapp.net",    // one digit long
    "5491155555556@s.whatsapp.net",     // last digit changed
  ]) {
    assert.ok(!sender(c, impostor).isOwner, `${impostor} must not be the owner`);
  }
});

test("a display name cannot make anyone the owner", () => {
  const c = cfg();
  const s = sender(c, STRANGER, { pushName: "Manuel (owner) — APX admin" });
  assert.ok(!s.isOwner);
  assert.equal(s.role, "guest");
});

test("with no owner configured, nobody is the owner", () => {
  const c = cfg({ owner_jid: "" });
  assert.ok(!sender(c, OWNER).isOwner);
  assert.equal(resolveReplyPolicy(c, sender(c, OWNER)), REPLY_POLICIES.SILENT);
});

// ── the allowlist ──────────────────────────────────────────────────────────

test("the owner gets a full turn; a known contact gets a text-only one", () => {
  const c = cfg();
  assert.equal(resolveReplyPolicy(c, sender(c, OWNER)), REPLY_POLICIES.FULL);
  assert.equal(resolveReplyPolicy(c, sender(c, CARLA)), REPLY_POLICIES.TEXT_ONLY);
});

test("an unknown sender is answered with silence, not with a guarded reply", () => {
  const c = cfg();
  assert.equal(resolveReplyPolicy(c, sender(c, STRANGER)), REPLY_POLICIES.SILENT);
});

test("a contact the owner muted individually goes silent", () => {
  const c = cfg({ contacts: [{ jid: CARLA, name: "Carla", role: "contact", auto_reply: false }] });
  assert.equal(resolveReplyPolicy(c, sender(c, CARLA)), REPLY_POLICIES.SILENT);
});

test("a role with no definition gets silence, not the benefit of the doubt", () => {
  // A typo'd or removed role must not silently widen access — same fail-closed
  // rule the Telegram tool gate follows.
  const c = cfg({ contacts: [{ jid: CARLA, name: "Carla", role: "cliente" }] });
  assert.equal(resolveReplyPolicy(c, sender(c, CARLA)), REPLY_POLICIES.SILENT);

  const withRole = cfg({
    contacts: [{ jid: CARLA, name: "Carla", role: "cliente" }],
    roles: { cliente: { auto_reply: true } },
  });
  assert.equal(resolveReplyPolicy(withRole, sender(withRole, CARLA)), REPLY_POLICIES.TEXT_ONLY);
});

test("groups are silent by default even when the sender is a known contact", () => {
  const c = cfg();
  const group = "120363000000000000@g.us";
  const inGroup = sender(c, CARLA, { chatJid: group });
  assert.ok(inGroup.isGroup);
  assert.equal(resolveReplyPolicy(c, inGroup), REPLY_POLICIES.SILENT);

  const opened = cfg({ reply_to_groups: true });
  assert.equal(
    resolveReplyPolicy(opened, sender(opened, CARLA, { chatJid: group })),
    REPLY_POLICIES.TEXT_ONLY
  );
});

test("auto_reply:false is a kill switch that still lets the owner through", () => {
  const c = cfg({ auto_reply: false });
  assert.equal(resolveReplyPolicy(c, sender(c, CARLA)), REPLY_POLICIES.SILENT);
  assert.equal(resolveReplyPolicy(c, sender(c, OWNER)), REPLY_POLICIES.FULL);
});

// ── recording is not permission ────────────────────────────────────────────

test("an unknown sender is recorded as a guest and stays unanswered", () => {
  const c = cfg();
  const before = resolveReplyPolicy(c, sender(c, STRANGER));
  const { mutated, created } = registerWhatsAppSender({
    cfg: c, senderJid: STRANGER, pushName: "Desconocido",
  });
  assert.ok(mutated && created, "the sender should now be on the list for the owner to see");

  // The whole point: being on the list is not being allowed. Nothing about the
  // policy changed by the act of writing them down.
  const after = resolveWhatsAppSender({ cfg: c, senderJid: STRANGER });
  assert.equal(after.role, "guest");
  assert.equal(resolveReplyPolicy(c, after), before);
  assert.equal(resolveReplyPolicy(c, after), REPLY_POLICIES.SILENT);
});

// ── LID addressing: one person, two addresses ──────────────────────────────

test("a sender is an address SET, because WhatsApp names people two ways", async () => {
  const { senderAddresses } = await import("#core/identity/whatsapp.js");
  // 1:1 chat where the message arrives under a LID and carries the phone as alt.
  assert.deepEqual(
    senderAddresses({ remoteJid: "101666238013462@lid", remoteJidAlt: "5492944636430@s.whatsapp.net" }),
    ["101666238013462@lid", "5492944636430@s.whatsapp.net"]
  );
  // In a group the person is `participant`, not the chat.
  assert.deepEqual(
    senderAddresses({ remoteJid: "1203630@g.us", participant: CARLA }),
    [CARLA]
  );
  assert.deepEqual(senderAddresses({}), []);
});

test("the owner is recognised through EITHER address", async () => {
  const { senderAddresses } = await import("#core/identity/whatsapp.js");
  // The live bug, 2026-09-08: owner_jid held the phone number, the message
  // arrived as a LID, and the owner was answered with silence on their own line.
  const c = cfg({ owner_jid: "5492944636430@s.whatsapp.net" });
  const addresses = senderAddresses({
    remoteJid: "101666238013462@lid",
    remoteJidAlt: "5492944636430@s.whatsapp.net",
  });
  const s = resolveWhatsAppSender({ cfg: c, addresses });
  assert.ok(s.isOwner, "matched on the alt address");
  assert.equal(resolveReplyPolicy(c, s), REPLY_POLICIES.FULL);

  // And once learned, the LID alone is enough — which is the case that matters,
  // because the alt is not always present.
  const learned = cfg({ owner_jid: "5492944636430@s.whatsapp.net", owner_alts: ["101666238013462@lid"] });
  assert.ok(resolveWhatsAppSender({ cfg: learned, senderJid: "101666238013462@lid" }).isOwner);
});

test("the paired line is not the owner unless someone says so", () => {
  const line = "5491164169115@s.whatsapp.net";
  const dedicated = cfg({ owner_jid: "", self_jid: line });
  assert.ok(!resolveWhatsAppSender({ cfg: dedicated, senderJid: line }).isOwner,
    "a dedicated line must not own itself");

  const ownPhone = cfg({ owner_jid: "", self_jid: line, self_is_owner: true });
  assert.ok(resolveWhatsAppSender({ cfg: ownPhone, senderJid: line }).isOwner);
});

test("a roster row claiming role owner is downgraded, not obeyed", () => {
  // Hand-edited config.json (or an agent writing the file directly) bypasses the
  // API's refusal. Ownership comes from ownerAddresses, so the row is demoted at
  // read time rather than trusted.
  const c = cfg({
    owner_jid: "",
    contacts: [{ jid: CARLA, name: "Carla", role: "owner", auto_reply: true }],
  });
  const s = resolveWhatsAppSender({ cfg: c, senderJid: CARLA });
  assert.ok(!s.isOwner);
  assert.equal(s.role, "contact", "demoted to the strongest thing a roster CAN grant");
});

test("status stories, Channels and WhatsApp's own numbers are not people writing", async () => {
  const { isIgnorableJid } = await import("#core/identity/whatsapp.js");

  // The feed, not a conversation: every contact's story arrives here all day.
  assert.equal(isIgnorableJid("status@broadcast"), true);
  assert.equal(isIgnorableJid("1234567@broadcast"), true);
  // WhatsApp Channels.
  assert.equal(isIgnorableJid("120363000000000000@newsletter"), true);
  // The null address protocol messages carry.
  assert.equal(isIgnorableJid("0@s.whatsapp.net"), true);
  assert.equal(isIgnorableJid("0@c.us"), true);
  // WhatsApp's own service numbers (verification codes, product tips).
  assert.equal(isIgnorableJid("16505361212@s.whatsapp.net"), true);
  assert.equal(isIgnorableJid("16508638904@s.whatsapp.net"), true);
  // Nobody to answer, nobody to tell.
  assert.equal(isIgnorableJid(""), true);
  assert.equal(isIgnorableJid(null), true);

  // And everything that IS a person or a room stays. A number that merely
  // starts with the service prefix is somebody else entirely.
  assert.equal(isIgnorableJid("5491155555555@s.whatsapp.net"), false);
  assert.equal(isIgnorableJid("5491155555555:12@s.whatsapp.net"), false);
  assert.equal(isIgnorableJid("101666238013462@lid"), false);
  assert.equal(isIgnorableJid("120363000000000000@g.us"), false);
  assert.equal(isIgnorableJid("165053612120@s.whatsapp.net"), false);
});
