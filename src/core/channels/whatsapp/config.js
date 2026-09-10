// WhatsApp channel configuration: the session and the roster.
//
// Shape in ~/.apx/config.json:
//
//   "whatsapp": {
//     "enabled": true,
//     "self_jid":  "5491164169115@s.whatsapp.net",  // the line, recorded at connect
//     "owner_jid": "5492944636430@s.whatsapp.net",  // the HUMAN — set by promoting a contact
//     "self_is_owner": false,                       // tick when the line IS the owner's own phone
//     "owner_alts": ["101666238013462@lid"],        // their other addresses, learned
//     "auto_reply": true,          // master switch for non-owner replies
//     "reply_to_groups": false,
//     "project": "/path/to/proj",  // where owner turns run; default project if unset
//     "contacts": [ {
//        jid, name, nickname, relationship, bio, rules,
//        role, auto_reply, first_seen, last_seen
//     } ],
//     "roles": { "<role>": { "auto_reply": true } }
//   }
//
// Deliberately ONE session, not a `channels[]` array like Telegram. Telegram
// multiplexes because a bot token is cheap and you can have twenty; a WhatsApp
// session is an account, and an account is a phone number. Modelling a
// singleton as a list invites two sessions racing over one set of credentials.
// If a second number ever exists, that is the day to add `sessions[]` — not
// before.
import { readConfig, writeConfig } from "../../config/index.js";
import { normalizeJid } from "../../identity/whatsapp.js";
import { SENDER_ROLES } from "../../constants/roles.js";
import { RELATIONSHIPS, isRelationship } from "./relationships.js";

// `self_jid` is the line (recorded at connect); `owner_jid` is the human who
// owns it (typed in the panel) and `owner_alts` the other addresses that same
// human turned out to have. Three different things — see identity/whatsapp.js.
const SETTABLE = [
  "enabled", "auto_reply", "reply_to_groups", "project",
  "owner_jid", "self_jid", "self_is_owner",
  // Defaults every contact inherits unless their own row overrides them.
  "capabilities", "facts",
  // How long a turn may run before it is cut and answered with the never-silent
  // floor. Settable because the right number depends on the models in use, and
  // the failure it guards against — a chat that just stops answering — is one
  // the operator sees long before anyone here does.
  "turn_deadline_ms", "third_party_deadline_ms",
];

/**
 * What a conversation is allowed to DO, beyond answering.
 *
 * None of these is a tool. A turn for a non-owner has no tools at all and that
 * does not change — a capability means the conversation may CAPTURE something
 * (which reaches the owner as a suggestion to confirm) or may ANSWER from a
 * text the owner wrote. Nothing here books, sends, promises or decides.
 *
 * Off by default, all of them: the safe answer to "may this stranger schedule
 * something" is no, and a default that says yes is a default nobody chose.
 */
export const CAPABILITIES = Object.freeze([
  // The contact asks for a time → {who, what, when} is captured and proposed.
  "appointments",
  // Any other request → captured as fields instead of a paragraph.
  "errands",
  // May answer from `facts` without checking with the owner first.
  "facts",
]);

/** Contact overrides global, per capability, with `false` meaning false. */
export function resolveCapabilities(cfg, contact) {
  const globals = cfg?.whatsapp?.capabilities || {};
  const own = contact?.capabilities || {};
  const out = {};
  for (const k of CAPABILITIES) out[k] = own[k] !== undefined ? own[k] === true : globals[k] === true;
  return out;
}

/** The text this contact may answer from: their own, else the global one. */
export function resolveFacts(cfg, contact) {
  const own = String(contact?.facts || "").trim();
  return own || String(cfg?.whatsapp?.facts || "").trim();
}

export function readWhatsAppConfig(cfg = readConfig()) {
  const wa = cfg.whatsapp || {};
  return {
    enabled: wa.enabled !== false,
    auto_reply: wa.auto_reply !== false,
    reply_to_groups: wa.reply_to_groups === true,
    project: wa.project || "",
    owner_jid: wa.owner_jid || "",
    owner_alts: Array.isArray(wa.owner_alts) ? wa.owner_alts : [],
    self_jid: wa.self_jid || "",
    self_is_owner: wa.self_is_owner === true,
    contacts: Array.isArray(wa.contacts) ? wa.contacts : [],
    roles: wa.roles || {},
    capabilities: wa.capabilities || {},
    facts: wa.facts || "",
  };
}

export function patchWhatsAppConfig(patch = {}) {
  const cfg = readConfig();
  cfg.whatsapp = cfg.whatsapp || {};
  for (const k of SETTABLE) {
    if (patch[k] === undefined) continue;
    cfg.whatsapp[k] = (k === "owner_jid" || k === "self_jid")
      ? (normalizeJid(patch[k]) || "")
      : patch[k];
  }
  writeConfig(cfg);
  return readWhatsAppConfig(cfg);
}

export function listWhatsAppContacts(cfg = readConfig()) {
  return readWhatsAppConfig(cfg).contacts.slice();
}

/**
 * Create or patch one contact.
 *
 * `role` is the field that grants anything, so it is validated against the
 * known roles rather than stored as typed: a role of "conctact" would resolve
 * to silence forever and look like a bug in the socket.
 */
export function upsertWhatsAppContact(jid, patch = {}) {
  const key = normalizeJid(jid);
  if (!key) throw new Error("upsertWhatsAppContact: a valid jid or phone number is required");

  const cfg = readConfig();
  cfg.whatsapp = cfg.whatsapp || {};
  if (!Array.isArray(cfg.whatsapp.contacts)) cfg.whatsapp.contacts = [];

  // VALIDATE BEFORE MUTATING. The row used to be pushed first and the fields
  // checked afterwards, so a bad `role` or `relationship` threw with a half-made
  // contact already sitting in the in-memory config — invisible on disk, and
  // read back as a nameless stranger by anything holding that object.
  validateRole(cfg, patch.role);
  validateRelationship(patch.relationship);

  let entry = cfg.whatsapp.contacts.find((c) => normalizeJid(c.jid) === key);
  if (!entry) {
    entry = { jid: key, first_seen: new Date().toISOString() };
    cfg.whatsapp.contacts.push(entry);
  }
  // Who this person IS, in the owner's own words. All four reach the turn that
  // answers them (buildWhatsAppRelationshipBlock) and nothing else — they are
  // per-contact by construction, so what the owner writes about their wife is
  // never in the prompt that answers a plumber.
  //
  // Capped, and not for tidiness: this text lands in a system prompt on every
  // message from that person, so an unbounded field is an unbounded per-turn
  // cost, and a long one buries the rules that matter underneath a biography.
  if (patch.name !== undefined) entry.name = String(patch.name || "");
  if (patch.nickname !== undefined) entry.nickname = String(patch.nickname || "").slice(0, 60);
  if (patch.relationship !== undefined) entry.relationship = String(patch.relationship || "").trim();
  if (patch.bio !== undefined) entry.bio = String(patch.bio || "").slice(0, 600);
  if (patch.rules !== undefined) entry.rules = String(patch.rules || "").slice(0, 900);
  // What this person may be told without asking the owner. Capped like the rest
  // — it rides in a system prompt on every message from them.
  if (patch.facts !== undefined) entry.facts = String(patch.facts || "").slice(0, 1200);
  if (patch.capabilities !== undefined && patch.capabilities && typeof patch.capabilities === "object") {
    const next = {};
    for (const k of CAPABILITIES) {
      if (patch.capabilities[k] !== undefined) next[k] = patch.capabilities[k] === true;
    }
    entry.capabilities = { ...(entry.capabilities || {}), ...next };
  }
  // `note` predates the four fields above and is kept so existing rosters do not
  // lose anything; new writing should go to bio/rules.
  if (patch.note !== undefined) entry.note = String(patch.note || "");
  if (patch.auto_reply !== undefined) entry.auto_reply = patch.auto_reply !== false;
  if (patch.role !== undefined) entry.role = String(patch.role || "").trim() || SENDER_ROLES.GUEST;
  // Editing a row IS reviewing it.
  //
  // `pending_review` is set by vouchWhatsAppRecipient on somebody APX added
  // because the owner told it to write to them — answerable, but nobody has
  // said who they are or what may be done with them. The moment a human (or an
  // agent acting for one) touches the row, that question has been answered, so
  // the flag is cleared HERE rather than in each caller: the panel, the API and
  // the whatsapp_contacts tool all come through this one door, and a rule that
  // lives in one of them is a rule the other two do not have.
  delete entry.pending_review;
  writeConfig(cfg);
  return entry;
}

/**
 * Owner is not grantable from a roster row: it is decided by ownerAddresses,
 * before any message is read. Letting the address book assert it would put the
 * one identity everything else hangs off inside a text field.
 */
function validateRole(cfg, role) {
  if (role === undefined) return;
  const value = String(role || "").trim();
  if (!value) return;
  if (value === SENDER_ROLES.OWNER) throw new Error("owner is set by pairing, not by the roster");
  const known = new Set([...Object.values(SENDER_ROLES), ...Object.keys(cfg.whatsapp?.roles || {})]);
  if (!known.has(value)) throw new Error(`unknown role "${value}" — define it first`);
}

/**
 * A category, not a sentence. "esposa de Manu" belongs in `bio` — and was in
 * fact being written to both, which is how one prompt came to say the same
 * thing twice. The error names the options so an agent writing through the API
 * learns them instead of guessing again.
 */
function validateRelationship(rel) {
  if (rel === undefined) return;
  const value = String(rel || "").trim();
  if (value && !isRelationship(value)) {
    throw new Error(`unknown relationship "${value}" — one of: ${RELATIONSHIPS.join(", ")}`);
  }
}

export function removeWhatsAppContact(jid) {
  const key = normalizeJid(jid);
  const cfg = readConfig();
  const before = (cfg.whatsapp?.contacts || []).length;
  if (!cfg.whatsapp) return false;
  cfg.whatsapp.contacts = (cfg.whatsapp.contacts || []).filter((c) => normalizeJid(c.jid) !== key);
  writeConfig(cfg);
  return cfg.whatsapp.contacts.length < before;
}

export function setWhatsAppRole(name, def = {}) {
  const role = String(name || "").trim();
  if (!role) throw new Error("role name required");
  if (role === SENDER_ROLES.OWNER) throw new Error("the owner role is implicit");
  const cfg = readConfig();
  cfg.whatsapp = cfg.whatsapp || {};
  cfg.whatsapp.roles = cfg.whatsapp.roles || {};
  cfg.whatsapp.roles[role] = { auto_reply: def.auto_reply !== false };
  writeConfig(cfg);
  return cfg.whatsapp.roles[role];
}

export function removeWhatsAppRole(name) {
  const cfg = readConfig();
  if (!cfg.whatsapp?.roles?.[name]) return false;
  delete cfg.whatsapp.roles[name];
  writeConfig(cfg);
  return true;
}
