// Sender identity for WhatsApp, and the decision that follows from it: whether
// this message gets answered at all.
//
// The Telegram module next door resolves a role and hands it to a tool gate. On
// WhatsApp that is not enough, and the difference is the whole reason this file
// exists rather than a `platform` argument over there:
//
//   A Telegram bot is only reachable by someone who went looking for it. The
//   owner's WhatsApp number is reachable by every person who has ever had it,
//   plus every group they were added to, plus whoever bought a list with it on
//   it. "Unknown sender" on Telegram is a curiosity. Here it is the default.
//
// So the unit of decision is not "which tools" but "do we speak", and the
// answer for anyone the owner has not explicitly added is NO. Not a guarded
// reply, not a polite deflection — nothing, and a line in the log for the owner
// to look at. An allowlist is the only shape that survives a number leaking.
//
// The identity itself is the JID, WhatsApp's stable account id, never the
// display name (`pushName` is chosen by the sender and can be anyone's) and
// never the group id (a person is the same person in every group).
import { readConfig, writeConfig } from "../config/index.js";
import { SENDER_ROLES } from "../constants/roles.js";

/** What a turn is allowed to be for this sender. Ordered most to least. */
export const REPLY_POLICIES = Object.freeze({
  /** The owner: the real super-agent turn, full context, tools per config. */
  FULL: "full",
  /** A known contact: tool-free turn, third-party prompt, text out. */
  TEXT_ONLY: "text_only",
  /** Everyone else: no turn runs. Logged, never answered. */
  SILENT: "silent",
});

const PERSON_SUFFIX = "@s.whatsapp.net";
const GROUP_SUFFIX = "@g.us";

/**
 * Canonical form of whatever was written down as a WhatsApp address.
 *
 * The owner types a phone number into a settings field ("+54 9 11 5555-5555");
 * the socket reports a JID ("5491155555555@s.whatsapp.net"); a group is
 * "...@g.us"; newer stacks also hand out "...@lid". These have to compare equal
 * when they name the same account, because the comparison that uses this
 * function is the one that decides who the owner is.
 *
 * Returns null for anything it cannot parse, and every caller treats null as
 * "not a match" — an address we failed to understand must never resolve to the
 * owner by accident.
 */
export function normalizeJid(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Already a JID: keep the domain, strip the device/agent suffix WhatsApp
  // appends to the user part (":12" in "5491155555555:12@s.whatsapp.net"),
  // which varies per linked device and would break equality.
  const at = raw.lastIndexOf("@");
  if (at > 0) {
    const user = raw.slice(0, at).split(":")[0].replace(/\D/g, "");
    const domain = raw.slice(at + 1).toLowerCase();
    if (!user) return null;
    return `${user}@${domain}`;
  }

  // A bare phone number. Digits only; "+" and separators are presentation.
  const digits = raw.replace(/\D/g, "");
  // Shorter than this is a shortcode or a typo, not a reachable number, and
  // treating a typo as an address is how the wrong person becomes the owner.
  if (digits.length < 8) return null;
  return `${digits}${PERSON_SUFFIX}`;
}

/**
 * Every address that names the SAME sender on one message.
 *
 * WhatsApp addresses a person two ways and hands us whichever one applies to
 * the context: the phone JID (`5491155555555@s.whatsapp.net`) and the LID
 * (`101666238013462@lid`), its privacy-preserving id. A message carries one as
 * the primary and, when it knows it, the other in `…Alt`.
 *
 * Comparing only the primary is how the owner ends up a stranger on their own
 * line: observed 2026-09-08, the owner wrote in, the message arrived as a LID,
 * `owner_jid` held their phone number, and they were answered with silence.
 * Identity here has to be a SET, not a value.
 */
export function senderAddresses(key = {}) {
  // In a group `participant` is the person and `remoteJid` is the group; in a
  // 1:1 chat `remoteJid` is the person.
  const primary = key.participant || key.remoteJid;
  const alt = key.participantAlt || key.remoteJidAlt;
  const out = [];
  for (const raw of [primary, alt]) {
    const n = normalizeJid(raw);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Do these two address sets name the same person? */
export function sameSender(a = [], b = []) {
  return a.some((x) => b.includes(x));
}

export function isGroupJid(jid) {
  return String(jid || "").toLowerCase().endsWith(GROUP_SUFFIX);
}

// WhatsApp delivers more than conversations down the same socket, and none of
// the rest is somebody talking to you:
//
//   status@broadcast   every contact's status/story, all day
//   …@newsletter       WhatsApp Channels you follow
//   …@broadcast        a broadcast list (only ever the sender's own address —
//                      a broadcast you RECEIVE arrives as an ordinary chat)
//   0@…                the null address protocol messages carry
//
// plus WhatsApp's own service numbers, which send verification codes and
// product tips: +1 (650) 536-1212 is the account/verification sender and
// +1 (650) 863-8904 is "WhatsApp" itself. Written out because a bare number in
// a predicate is unreadable a month later.
const WHATSAPP_SERVICE_NUMBERS = ["16505361212", "16508638904"];

/**
 * Is this address something we should never treat as a message?
 *
 * A deliberate exception to this channel's rule that every message is logged
 * whether or not it is answered. That rule is about PEOPLE — the owner must be
 * able to see that a stranger wrote even when nobody replied. A status story is
 * not a person writing: it is a feed, it arrives dozens of times a day, and
 * logging it would bury the messages that are.
 *
 * An absent address counts as ignorable: there is nobody to answer and nobody
 * to tell about it.
 */
export function isIgnorableJid(jid) {
  if (!jid) return true;
  const s = String(jid).toLowerCase();
  const user = s.split("@")[0];
  return (
    s.endsWith("@broadcast") ||
    s.endsWith("@newsletter") ||
    user === "0" ||
    WHATSAPP_SERVICE_NUMBERS.includes(user)
  );
}

function whatsappConfig(cfg) {
  return (cfg && cfg.whatsapp) || {};
}

/**
 * Every address that counts as the owner.
 *
 * `owner_jid` is the one a person types; `owner_alts` are the other addresses
 * the same human turned out to have (their LID, a second line), learned the
 * first time a message carried both. `self_jid` — the account that paired — is
 * included because a message from your own line is yours by definition.
 *
 * Note what is NOT here: a roster row. A contact row claiming `role: "owner"`
 * grants nothing, because ownership is not something the address book gets to
 * assert about itself.
 */
export function ownerAddresses(cfg) {
  const wa = whatsappConfig(cfg);
  // `self_jid` counts ONLY when the owner said so. Off by default, because the
  // common shape here is a dedicated line the assistant answers on while the
  // human writes to it from their own phone — and quietly treating the line as
  // its own owner is what made the actual human a stranger on it.
  const raw = [
    wa.owner_jid,
    ...(Array.isArray(wa.owner_alts) ? wa.owner_alts : []),
    ...(wa.self_is_owner === true ? [wa.self_jid] : []),
  ];
  const out = [];
  for (const r of raw) {
    const n = normalizeJid(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function contactsArray(cfg) {
  const wa = whatsappConfig(cfg);
  return Array.isArray(wa.contacts) ? wa.contacts : [];
}

/** Every address recorded for one roster row (its jid plus learned aliases). */
function contactAddresses(c) {
  const raw = [c?.jid, ...(Array.isArray(c?.alts) ? c.alts : [])];
  const out = [];
  for (const r of raw) {
    const n = normalizeJid(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Find a contact by ANY of their addresses.
 *
 * Accepts a single jid or a list, so a caller holding both the LID and the
 * phone number for one message finds the row whichever one was written down.
 */
export function findWhatsAppContact(cfg, jidOrList) {
  const want = (Array.isArray(jidOrList) ? jidOrList : [jidOrList])
    .map(normalizeJid)
    .filter(Boolean);
  if (!want.length) return null;
  return contactsArray(cfg).find((c) => contactAddresses(c).some((a) => want.includes(a))) || null;
}

/**
 * Who sent this, relative to the configured session. Read-only.
 *
 * `senderJid` is the person even in a group, where `chatJid` is the group. Both
 * matter: the role comes from the person, the audience from the chat.
 */
export function resolveWhatsAppSender({ cfg, senderJid, addresses = null, chatJid = null, pushName = "" }) {
  // `addresses` is the real input (see senderAddresses); `senderJid` stays
  // supported so a caller with one address — a CLI, a test — still works.
  const addrs = (addresses && addresses.length ? addresses : [senderJid])
    .map(normalizeJid)
    .filter(Boolean);
  const jid = addrs[0] || null;
  const contact = addrs.length ? findWhatsAppContact(cfg, addrs) : null;
  const isGroup = isGroupJid(chatJid || "");

  // Owner is an exact match of ANY of this sender's addresses against ANY of
  // the owner's. Not "starts with", not "contains", and never inferred from a
  // display name — but no longer a single-value comparison either, which is
  // what made a LID-addressed owner a stranger.
  const owners = ownerAddresses(cfg);
  const isOwner = addrs.some((a) => owners.includes(a));

  // A roster row cannot promote itself. `role: "owner"` hand-written into
  // config.json (or set by an agent editing the file directly) is downgraded
  // here rather than trusted: ownership comes from ownerAddresses, full stop.
  const claimed = contact?.role;
  const rosterRole = claimed === SENDER_ROLES.OWNER ? SENDER_ROLES.CONTACT : claimed;

  const role = isOwner ? SENDER_ROLES.OWNER : rosterRole || SENDER_ROLES.GUEST;

  return {
    addresses: addrs,
    // `userId` rather than `jid` so buildRelationshipBlock — which is
    // platform-agnostic and already used by Telegram — reads it unchanged.
    userId: jid,
    jid,
    chatJid: chatJid || jid,
    username: "",
    name: contact?.name || pushName || "unknown",
    role,
    isOwner,
    isGroup,
    known: !!contact || isOwner,
    note: contact?.note || "",
  };
}

/**
 * Do we answer this person, and with what kind of turn?
 *
 * Fail closed at every branch. The cases that return SILENT are not errors —
 * silence is the designed outcome for anyone the owner has not vouched for, and
 * for every group unless the owner turned groups on.
 */
export function resolveReplyPolicy(cfg, sender) {
  const wa = whatsappConfig(cfg);

  // A kill switch that does not depend on the socket being down.
  if (wa.auto_reply === false) {
    return sender?.isOwner ? REPLY_POLICIES.FULL : REPLY_POLICIES.SILENT;
  }

  if (sender?.isOwner) return REPLY_POLICIES.FULL;

  // Groups are off unless explicitly enabled: in a group every reply is read by
  // people who were never vouched for, so one allowed contact in it is not
  // consent from the rest.
  if (sender?.isGroup && wa.reply_to_groups !== true) return REPLY_POLICIES.SILENT;

  // Not on the list → not answered. This is the allowlist.
  if (!sender?.known) return REPLY_POLICIES.SILENT;

  // On the list, but muted individually.
  const contact = findWhatsAppContact(cfg, sender?.jid);
  if (contact?.auto_reply === false) return REPLY_POLICIES.SILENT;

  // A role the owner has defined can be muted wholesale; a role that is NOT
  // defined gets silence rather than the benefit of the doubt.
  const roleDef = wa.roles?.[sender?.role];
  if (roleDef?.auto_reply === false) return REPLY_POLICIES.SILENT;
  if (sender?.role !== SENDER_ROLES.CONTACT && !roleDef) return REPLY_POLICIES.SILENT;

  return REPLY_POLICIES.TEXT_ONLY;
}

/**
 * Record a sender we have not seen before, so the owner has something to click
 * "allow" on. Recording is NOT permission: a newly recorded contact lands as a
 * guest, which resolveReplyPolicy answers with silence.
 */
/**
 * The owner just wrote in under an address we did not know was theirs.
 *
 * Learned rather than asked for: nobody knows their own LID, it is not shown
 * anywhere in WhatsApp, and requiring it in a settings field would be asking
 * for a number the person cannot look up. When one message carries both
 * addresses and one of them is already the owner's, the other one is too.
 */
/**
 * Promote a contact to owner, by any address they are known under.
 *
 * This is the escape hatch for an identity nobody can look up. WhatsApp may
 * address a person by a LID (`101666238013462@lid`) that appears nowhere in the
 * app, so "type your number in the Owner field" cannot work for them: the
 * number they know is not the address the message arrives under.
 *
 * Writing to your own line and clicking a button on the row that appears needs
 * no such knowledge — whatever address it came in as is the one that gets
 * recorded, correct by construction.
 *
 * The row STAYS. It used to be deleted on the reasoning that the owner is not
 * their own contact, which is true and beside the point: from the panel it just
 * looked like the button had erased the person, with nothing to undo and no way
 * to check what had been recorded. The row is where you go to see and edit who
 * someone is; being the owner is a mark on it, not a reason to lose it.
 */
export function promoteToOwner(cfg, jidOrList) {
  const disk = readConfig();
  disk.whatsapp = disk.whatsapp || {};
  const contact = findWhatsAppContact(disk, jidOrList);
  const addrs = contact
    ? [contact.jid, ...(contact.alts || [])].map(normalizeJid).filter(Boolean)
    : [normalizeJid(Array.isArray(jidOrList) ? jidOrList[0] : jidOrList)].filter(Boolean);
  if (!addrs.length) return null;

  const [primary, ...rest] = addrs;
  const prevOwner = normalizeJid(disk.whatsapp.owner_jid);
  const prevAlts = Array.isArray(disk.whatsapp.owner_alts) ? disk.whatsapp.owner_alts : [];

  disk.whatsapp.owner_jid = primary;
  // An existing owner is not discarded — they become an alias. Somebody with
  // two phones promoting the second one means "this is me too", not "that other
  // number was a mistake".
  disk.whatsapp.owner_alts = [...new Set([...prevAlts, ...rest, ...(prevOwner && prevOwner !== primary ? [prevOwner] : [])])];
  writeConfig(disk);
  cfg.whatsapp = disk.whatsapp;
  return { owner_jid: primary, owner_alts: disk.whatsapp.owner_alts, name: contact?.name || "" };
}

/** Forget who the owner is, without touching the roster. */
export function clearOwner(cfg) {
  const disk = readConfig();
  disk.whatsapp = disk.whatsapp || {};
  disk.whatsapp.owner_jid = "";
  disk.whatsapp.owner_alts = [];
  writeConfig(disk);
  cfg.whatsapp = disk.whatsapp;
  return true;
}

export function learnOwnerAliases(cfg, addresses = []) {
  const known = ownerAddresses(cfg);
  const fresh = addresses.map(normalizeJid).filter((a) => a && !known.includes(a));
  if (!fresh.length) return false;

  const disk = readConfig();
  disk.whatsapp = disk.whatsapp || {};
  const alts = Array.isArray(disk.whatsapp.owner_alts) ? disk.whatsapp.owner_alts : [];
  disk.whatsapp.owner_alts = [...new Set([...alts, ...fresh])];
  writeConfig(disk);
  cfg.whatsapp = disk.whatsapp;
  return true;
}

export function registerWhatsAppSender({ cfg, senderJid, addresses = null, pushName = "", business = false }) {
  const addrs = (addresses && addresses.length ? addresses : [senderJid])
    .map(normalizeJid)
    .filter(Boolean);
  const jid = addrs[0] || null;
  if (!jid) return { mutated: false };

  // Re-read from disk so a role granted from the web/CLI seconds ago is honored
  // on the very next message, without a daemon reload. Same reasoning as the
  // Telegram module: inbound volume is low, a config read per message is cheap.
  const disk = readConfig();
  disk.whatsapp = disk.whatsapp || {};
  if (!Array.isArray(disk.whatsapp.contacts)) disk.whatsapp.contacts = [];
  cfg.whatsapp = disk.whatsapp;

  const now = new Date().toISOString();
  const existing = findWhatsAppContact(disk, addrs);

  if (!existing) {
    disk.whatsapp.contacts.push({
      jid,
      // The other addresses this same person answers to. Stored so the row is
      // found next time whichever one the message happens to carry — otherwise
      // one human accumulates a roster row per addressing scheme, each one a
      // guest, each one silently unanswered.
      ...(addrs.length > 1 ? { alts: addrs.slice(1) } : {}),
      name: pushName || "",
      // A verified business, not a person. Worth writing down: it is why this
      // row is addressed by an opaque LID with no phone number behind it, and
      // the panel has no other way to tell a company from a contact.
      ...(business ? { business: true } : {}),
      role: SENDER_ROLES.GUEST,
      auto_reply: false,
      first_seen: now,
      last_seen: now,
    });
    writeConfig(disk);
    cfg.whatsapp = disk.whatsapp;
    return { mutated: true, created: true };
  }

  // Merge any address we had not seen on this row before, even when the daily
  // touch below decides there is nothing else to write.
  const knownAddrs = [existing.jid, ...(existing.alts || [])].map(normalizeJid).filter(Boolean);
  const newAddrs = addrs.filter((a) => !knownAddrs.includes(a));
  if (newAddrs.length) {
    existing.alts = [...new Set([...(existing.alts || []), ...newAddrs])];
    writeConfig(disk);
    cfg.whatsapp = disk.whatsapp;
  }

  // Touch at most once a day — this runs on every inbound message.
  if (existing.last_seen?.slice(0, 10) === now.slice(0, 10)) return { mutated: newAddrs.length > 0 };
  existing.last_seen = now;
  // A name the owner wrote themselves outranks whatever the sender calls
  // themselves this week.
  if (!existing.name && pushName) existing.name = pushName;
  if (business && !existing.business) existing.business = true;
  writeConfig(disk);
  cfg.whatsapp = disk.whatsapp;
  return { mutated: true, created: false };
}

/**
 * Writing to somebody IS vouching for them.
 *
 * The roster is an allowlist for people who write to US, and it was only ever
 * fed from that direction — so APX could OPEN a conversation and then be unable
 * to continue it. That is not hypothetical: the agent introduced itself to a
 * new collaborator, he answered within the minute, and the reply resolved as a
 * stranger's and was met with silence. The agent had started a conversation it
 * was structurally incapable of having.
 *
 * The asymmetry was the bug. A send is not something that happens TO the owner;
 * they asked for it, through a tool marked dangerous that stops for permission
 * first. Somebody the owner deliberately messaged is not a stranger, and the
 * allowlist has to hear about it.
 *
 * Three things are deliberately left alone:
 *   - the OWNER, whose thread is not a roster row;
 *   - GROUPS, where a reply is read by everyone in it and one recipient is not
 *     consent from the rest;
 *   - anyone ALREADY carrying a role, including one the owner muted on purpose.
 *     Re-granting that on the next send would quietly undo their decision.
 *
 * @returns {{ vouched: boolean, promoted?: boolean, created?: boolean }}
 */
export function vouchWhatsAppRecipient(cfg, jid, { name = "" } = {}) {
  const key = normalizeJid(jid);
  if (!key || isGroupJid(key)) return { vouched: false };
  if (ownerAddresses(cfg).includes(key)) return { vouched: false };

  const disk = readConfig();
  disk.whatsapp = disk.whatsapp || {};
  if (!Array.isArray(disk.whatsapp.contacts)) disk.whatsapp.contacts = [];

  const now = new Date().toISOString();
  const existing = findWhatsAppContact(disk, key);

  // Already somebody. A guest is the one state that means "seen, never
  // decided", so it is the only one a send is allowed to settle.
  if (existing) {
    if (existing.role && existing.role !== SENDER_ROLES.GUEST) return { vouched: false };
    existing.role = SENDER_ROLES.CONTACT;
    existing.auto_reply = true;
    existing.vouched_by_send = now;
    existing.pending_review = true;
    if (!existing.name && name) existing.name = String(name);
    writeConfig(disk);
    syncContacts(cfg, disk);
    return { vouched: true, promoted: true };
  }

  disk.whatsapp.contacts.push({
    jid: key,
    name: String(name || ""),
    role: SENDER_ROLES.CONTACT,
    auto_reply: true,
    first_seen: now,
    last_seen: now,
    // Why this row exists, for whoever reads the roster later. A contact the
    // owner added by hand and one APX added because it was told to write are
    // the same permission but not the same decision.
    vouched_by_send: now,
    // Answerable, but NOT vetted. The owner never said who this is or what may
    // be done with them — only "write to them" — so the row carries the
    // difference instead of looking like a contact they curated by hand.
    pending_review: true,
  });
  writeConfig(disk);
  syncContacts(cfg, disk);
  return { vouched: true, created: true };
}

/**
 * Refresh the caller's roster from disk — the CONTACTS only.
 *
 * Assigning `cfg.whatsapp = disk.whatsapp` wholesale is what the inbound
 * registration does, and doing it here dropped `owner_jid` off any config whose
 * in-memory copy was ahead of disk: the very next send then filed the owner's
 * own thread under their phone number instead of the owner thread. Only the
 * contacts array changed, so only the contacts array is copied back.
 */
function syncContacts(cfg, disk) {
  if (!cfg) return;
  if (cfg.whatsapp && typeof cfg.whatsapp === "object") cfg.whatsapp.contacts = disk.whatsapp.contacts;
  else cfg.whatsapp = disk.whatsapp;
}

/** The owner's own thread. A constant so it cannot collide with a real jid,
 *  which always carries an "@". */
export const CONTACT_KEY_OWNER = "owner";

/**
 * The stable key that says WHICH conversation a message belongs to.
 *
 * A WhatsApp channel is not one conversation the way Telegram is: the same
 * ledger holds the owner, their partner and a stranger, and reading them as one
 * thread is how a private message ends up displayed under someone else's name.
 * So every row records the person it belongs to, and the thread store groups by
 * it.
 *
 * It is NOT the raw sender jid, and that distinction is the whole point. One
 * human reaches us from several addresses — their LID in a group, their phone
 * number in a direct chat — and keying by the address would give that person
 * two threads that each hold half of what they said. The roster already knows
 * which addresses are the same person; this asks it.
 *
 *  - the owner is always `"owner"`, whichever of their lines wrote
 *  - a known contact is their roster jid, so an alias folds into the same thread
 *  - a stranger is their own normalized address, which is all we know about them
 *
 * Returns null when there is no address at all — the caller writes no key and
 * the row stays in the channel's unscoped thread, which is also where every row
 * written before this existed lives.
 */
export function contactKeyFor(cfg, sender) {
  if (sender?.isOwner) return CONTACT_KEY_OWNER;
  const addrs = (sender?.addresses?.length ? sender.addresses : [sender?.jid])
    .map(normalizeJid)
    .filter(Boolean);
  if (!addrs.length) return null;
  const contact = findWhatsAppContact(cfg, addrs);
  return normalizeJid(contact?.jid) || addrs[0];
}
