// Telegram identity: channels, contacts and roles.
//
// This is channel domain, not configuration plumbing — it happened to live in
// core/config/index.js because the data is stored in the global config file.
// That made the config module 711 lines, half of them Telegram, and forced
// host/daemon/api/telegram.js to import 13 symbols from "the config module".
//
// The shapes:
//   cfg.telegram.channels[] — { name, bot_token, chat_id, route_to_agent,
//     project, respond_with_engine, poll_interval_ms, owner_user_id }
//   cfg.telegram.contacts[] — the global roster, keyed by Telegram user_id.
//     Identity is per-person and the same across every chat; a channel's
//     owner_user_id only marks who owns *that* channel.
//   cfg.telegram.roles    — role -> capabilities. "owner" is implicit (full),
//     "guest" is the default for unknown senders (no tools).
//
// Re-exported from core/config/index.js so existing import sites keep working.
import { writeConfig } from "../../config/index.js";

// ── Telegram channels (multi-channel mode) ──────────────────────────────────
// Each entry in cfg.telegram.channels[] is { name, bot_token, chat_id,
// route_to_agent, project, respond_with_engine, poll_interval_ms }.
// These helpers keep the array shape stable for the CLI and the daemon API.

const CHANNEL_FIELDS = [
  "name",
  "bot_token",
  "chat_id",
  "route_to_agent",
  "project",
  "respond_with_engine",
  "poll_interval_ms",
  "owner_user_id",
];

function ensureChannelsArray(cfg) {
  cfg.telegram = cfg.telegram || {};
  if (!Array.isArray(cfg.telegram.channels)) cfg.telegram.channels = [];
  return cfg.telegram.channels;
}

export function listTelegramChannels(cfg) {
  return ensureChannelsArray(cfg).slice();
}

export function findTelegramChannel(cfg, name) {
  return ensureChannelsArray(cfg).find((c) => c.name === name) || null;
}

// Create-or-patch a channel by name. `patch` is a partial channel object;
// unknown keys are dropped. Returns { created, channel }.
export function upsertTelegramChannel(cfg, name, patch = {}) {
  if (!name || typeof name !== "string")
    throw new Error("upsertTelegramChannel: name required");
  const channels = ensureChannelsArray(cfg);
  let entry = channels.find((c) => c.name === name);
  const created = !entry;
  if (!entry) {
    entry = { name };
    channels.push(entry);
  }
  for (const k of CHANNEL_FIELDS) {
    if (k === "name") continue;
    if (patch[k] !== undefined) entry[k] = patch[k];
  }
  // Default respond_with_engine to true on create.
  if (created && entry.respond_with_engine === undefined) {
    entry.respond_with_engine = true;
  }
  writeConfig(cfg);
  return { created, channel: entry };
}

export function removeTelegramChannel(cfg, name) {
  const channels = ensureChannelsArray(cfg);
  const before = channels.length;
  cfg.telegram.channels = channels.filter((c) => c.name !== name);
  const removed = before - cfg.telegram.channels.length;
  if (removed > 0) {
    // Explicit user-initiated removal — bypass the credential-loss guard
    // so the write goes through even when this empties the array.
    cfg._allowClear = true;
    writeConfig(cfg);
  }
  return { removed };
}

// Clear specific optional fields on a channel (project, route_to_agent, …).
// Returns { channel } or null when no such channel.
export function unsetTelegramChannelFields(cfg, name, fields = []) {
  const ch = findTelegramChannel(cfg, name);
  if (!ch) return null;
  let mutated = false;
  for (const f of fields) {
    if (!CHANNEL_FIELDS.includes(f) || f === "name") continue;
    if (f in ch) {
      delete ch[f];
      mutated = true;
    }
  }
  if (mutated) writeConfig(cfg);
  return { channel: ch };
}

// ── Telegram contacts (global roster, keyed by user_id) ─────────────────────
// Identity of a person is global; the per-channel owner_user_id only marks who
// owns a given channel. Role lives on the contact (global), per the chosen
// design — owner_user_id overrides it to "owner" for that channel only.

const CONTACT_FIELDS = [
  "user_id",
  "name",
  "username",
  "role",
  "note",
  "first_seen",
  "last_seen",
];

function ensureContactsArray(cfg) {
  cfg.telegram = cfg.telegram || {};
  if (!Array.isArray(cfg.telegram.contacts)) cfg.telegram.contacts = [];
  return cfg.telegram.contacts;
}

export function listContacts(cfg) {
  return ensureContactsArray(cfg).slice();
}

export function findContact(cfg, userId) {
  if (userId == null) return null;
  return (
    ensureContactsArray(cfg).find((c) => String(c.user_id) === String(userId)) ||
    null
  );
}

// Create-or-patch a contact by user_id. Unknown keys are dropped.
export function upsertContact(cfg, userId, patch = {}, { persist = true } = {}) {
  if (userId == null) throw new Error("upsertContact: user_id required");
  const contacts = ensureContactsArray(cfg);
  let entry = contacts.find((c) => String(c.user_id) === String(userId));
  const created = !entry;
  if (!entry) {
    entry = { user_id: userId };
    contacts.push(entry);
  }
  for (const k of CONTACT_FIELDS) {
    if (k === "user_id") continue;
    if (patch[k] !== undefined) entry[k] = patch[k];
  }
  if (persist) writeConfig(cfg);
  return { created, contact: entry };
}

export function setContactRole(cfg, userId, role) {
  const { contact } = upsertContact(cfg, userId, { role });
  return contact;
}

export function removeContact(cfg, userId) {
  const contacts = ensureContactsArray(cfg);
  const before = contacts.length;
  cfg.telegram.contacts = contacts.filter(
    (c) => String(c.user_id) !== String(userId)
  );
  const removed = before - cfg.telegram.contacts.length;
  if (removed > 0) writeConfig(cfg);
  return { removed };
}

export function setChannelOwner(cfg, channelName, userId) {
  return upsertTelegramChannel(cfg, channelName, { owner_user_id: userId });
}

// ── Telegram roles (role → capability map) ──────────────────────────────────

export function listRoles(cfg) {
  cfg.telegram = cfg.telegram || {};
  return { ...(cfg.telegram.roles || {}) };
}

export function setRole(cfg, name, def) {
  if (!name || typeof name !== "string") throw new Error("setRole: name required");
  cfg.telegram = cfg.telegram || {};
  cfg.telegram.roles = cfg.telegram.roles || {};
  cfg.telegram.roles[name] = def;
  writeConfig(cfg);
  return cfg.telegram.roles[name];
}

export function removeRole(cfg, name) {
  cfg.telegram = cfg.telegram || {};
  if (!cfg.telegram.roles || !(name in cfg.telegram.roles)) return { removed: 0 };
  if (name === "owner" || name === "guest") {
    throw new Error(`role "${name}" is built-in and cannot be removed`);
  }
  delete cfg.telegram.roles[name];
  writeConfig(cfg);
  return { removed: 1 };
}
