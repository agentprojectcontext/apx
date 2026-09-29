// Discord channel configuration: the bot, and which rooms it may speak in.
//
// Shape in ~/.apx/config.json:
//
//   "discord": {
//     "enabled": true,
//     "token": "…",                     // the bot token — a credential, never logged
//     "owner_ids": ["1234567890"],      // the owner's Discord user id(s)
//     "owner_only": false,              // true → answer ONLY the owner; everyone else is read, never answered
//     "names": ["roby"],                // words that count as calling the bot
//     "rules": "…",                     // hard rules for what it says — win over everything
//     "knowledge": "…",                 // what it can do and answer — written by the owner, public
//     "channels": {
//       "<channel_id>": { "mode": "always" | "mention" | "read", "name": "apx-help" }
//     },
//     "limits":  { user_cooldown_ms, channel_replies_per_hour, burst_window_ms },
//     "context": { recent_messages, recent_chars, summary_threshold, rag_hits }
//   }
//
// Deny by default. A channel that is not listed does not exist for APX: its
// messages are not stored, not indexed and never answered. Somebody creating a
// new channel on the server must not be enough to put the agent in it — the
// owner adds it, on purpose, with a mode.
//
// The three modes are about SPEAKING. Reading is the same in all of them: a
// listed channel is logged, indexed and summarised, because that is what lets
// the agent know what a room was talking about when it finally is called.
import { readConfig, writeConfig } from "#core/config/index.js";
import { isSecretMarker } from "#core/config/redact.js";

export const DISCORD_MODES = Object.freeze({
  // Answers every message in the room. For a help channel, where every message
  // is a question somebody wants answered.
  ALWAYS: "always",
  // Answers only when called: an @mention, a reply to one of its messages, or
  // its name in the text. The right mode for a general room.
  MENTION: "mention",
  // Never speaks. Reads, so the owner can ask what happened there.
  READ: "read",
  // Answers when called, AND — uncalled — when a cheap model call judges the
  // message one it can really help with, by the owner's `reply_when`. See gate.js.
  USEFUL: "useful",
});

const MODE_SET = new Set(Object.values(DISCORD_MODES));

export const DISCORD_LIMIT_DEFAULTS = Object.freeze({
  // Between two answers to the same person. Stops one user from turning the
  // bot into a slot machine.
  user_cooldown_ms: 20_000,
  // Answers per room per rolling hour. The ceiling on what a busy or hostile
  // room can cost, whatever the individual cooldowns allow.
  channel_replies_per_hour: 30,
  // Several calls from one person inside this window are one conversation, not
  // several: they get one answer.
  burst_window_ms: 8_000,
  // Uncalled messages the `useful` gate may evaluate per room per hour. Each
  // one is a model call; this is the ceiling on what a chatty room costs.
  gate_checks_per_hour: 120,
});

// How long the "when to reply" criterion may be. It rides in every gate call.
export const REPLY_WHEN_MAX_CHARS = 2_000;
// The owner's rules ride in every turn too, last in the prompt, where they win.
export const RULES_MAX_CHARS = 2_000;

export const DISCORD_CONTEXT_DEFAULTS = Object.freeze({
  // The last messages of the room, verbatim. The layer that answers "what do
  // you think of this?" — nearly always enough on its own.
  recent_messages: 25,
  // A hard cap on those same messages in characters, so twenty-five walls of
  // pasted logs cannot become the whole prompt.
  recent_chars: 6_000,
  // Messages in a room before its oldest ones are folded into a summary.
  summary_threshold: 80,
  // Older fragments recalled by similarity to what was just asked.
  rag_hits: 5,
});

// How long the owner's notes may be. They ride in every Discord turn: a page of
// what the bot is for and where the docs are helps; a docs site pasted in does
// not, and costs every call.
export const KNOWLEDGE_MAX_CHARS = 12_000;

const SETTABLE = ["enabled", "token", "owner_ids", "owner_only", "names", "knowledge", "reply_when", "gate_model", "rules"];

export function normalizeDiscordMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  return MODE_SET.has(m) ? m : null;
}

// Discord ids are snowflakes: digits, 17–20 of them. Anything else is a typo,
// and a typo in an allowlist is a room that silently never works.
export function isSnowflake(id) {
  return /^\d{15,21}$/.test(String(id || "").trim());
}

function positive(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function listOfIds(v) {
  return (Array.isArray(v) ? v : [])
    .map((x) => String(x || "").trim())
    .filter(isSnowflake);
}

function listOfNames(v) {
  return (Array.isArray(v) ? v : [])
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
}

function normalizeChannels(raw) {
  const out = {};
  for (const [id, row] of Object.entries(raw || {})) {
    if (!isSnowflake(id)) continue;
    const mode = normalizeDiscordMode(row?.mode);
    if (!mode) continue;
    out[id] = { mode, ...(row?.name ? { name: String(row.name) } : {}) };
  }
  return out;
}

/**
 * The effective Discord settings. Never includes the token — `hasToken` says
 * whether there is one, which is all a status line or a panel needs to know.
 */
export function readDiscordConfig(cfg = readConfig()) {
  const d = cfg.discord || {};
  const limits = d.limits || {};
  const context = d.context || {};
  return {
    enabled: d.enabled !== false,
    hasToken: typeof d.token === "string" && d.token.trim().length > 0,
    owner_ids: listOfIds(d.owner_ids),
    // Off unless it is literally `true`: a typo must not silence a help room.
    owner_only: d.owner_only === true,
    names: listOfNames(d.names),
    knowledge: typeof d.knowledge === "string" ? d.knowledge : "",
    reply_when: typeof d.reply_when === "string" ? d.reply_when : "",
    rules: typeof d.rules === "string" ? d.rules : "",
    gate_model: typeof d.gate_model === "string" ? d.gate_model : "",
    channels: normalizeChannels(d.channels),
    limits: Object.fromEntries(
      Object.entries(DISCORD_LIMIT_DEFAULTS).map(([k, def]) => [k, positive(limits[k], def)])
    ),
    context: Object.fromEntries(
      Object.entries(DISCORD_CONTEXT_DEFAULTS).map(([k, def]) => [k, positive(context[k], def)])
    ),
  };
}

/** The token, for the one caller that connects. Kept out of readDiscordConfig on purpose. */
export function discordToken(cfg = readConfig()) {
  const t = cfg?.discord?.token;
  return typeof t === "string" ? t.trim() : "";
}

export function patchDiscordConfig(patch = {}) {
  const cfg = readConfig();
  cfg.discord = cfg.discord || {};
  for (const k of SETTABLE) {
    if (patch[k] === undefined) continue;
    // The panel echoes the redaction marker back for "unchanged".
    if (k === "token" && isSecretMarker(patch[k])) continue;
    if (k === "owner_ids") {
      const ids = (Array.isArray(patch[k]) ? patch[k] : [patch[k]]).map(String);
      const bad = ids.filter((x) => !isSnowflake(x));
      if (bad.length) throw new Error(`not a Discord user id: ${bad.join(", ")}`);
      cfg.discord[k] = ids;
    } else if (k === "knowledge") {
      const text = String(patch[k] || "");
      if (text.length > KNOWLEDGE_MAX_CHARS) {
        throw new Error(`the notes are ${text.length} characters; the limit is ${KNOWLEDGE_MAX_CHARS}`);
      }
      cfg.discord[k] = text;
    } else if (k === "reply_when") {
      const text = String(patch[k] || "");
      if (text.length > REPLY_WHEN_MAX_CHARS) {
        throw new Error(`the reply criterion is ${text.length} characters; the limit is ${REPLY_WHEN_MAX_CHARS}`);
      }
      cfg.discord[k] = text;
    } else if (k === "rules") {
      const text = String(patch[k] || "");
      if (text.length > RULES_MAX_CHARS) {
        throw new Error(`the rules are ${text.length} characters; the limit is ${RULES_MAX_CHARS}`);
      }
      cfg.discord[k] = text;
    } else if (k === "gate_model") {
      const m = String(patch[k] || "").trim();
      if (m && !m.includes(":")) throw new Error("gate_model must be provider:model");
      cfg.discord[k] = m;
    } else if (k === "owner_only") {
      if (typeof patch[k] !== "boolean") throw new Error("owner_only must be true or false");
      cfg.discord[k] = patch[k];
    } else if (k === "names") {
      cfg.discord[k] = listOfNames(Array.isArray(patch[k]) ? patch[k] : [patch[k]]);
    } else {
      cfg.discord[k] = patch[k];
    }
  }
  for (const group of ["limits", "context"]) {
    if (!patch[group] || typeof patch[group] !== "object") continue;
    const defaults = group === "limits" ? DISCORD_LIMIT_DEFAULTS : DISCORD_CONTEXT_DEFAULTS;
    cfg.discord[group] = cfg.discord[group] || {};
    for (const [k, v] of Object.entries(patch[group])) {
      if (!(k in defaults)) throw new Error(`unknown discord ${group} key: ${k}`);
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`discord ${group}.${k} must be a number ≥ 0`);
      cfg.discord[group][k] = n;
    }
  }
  writeConfig(cfg);
  return readDiscordConfig(cfg);
}

/** Put a channel on the list, or change its mode. */
export function setDiscordChannel(id, { mode, name } = {}) {
  const key = String(id || "").trim();
  if (!isSnowflake(key)) throw new Error(`not a Discord channel id: ${id}`);
  const m = normalizeDiscordMode(mode);
  if (!m) throw new Error(`mode must be one of: ${[...MODE_SET].join(", ")}`);
  const cfg = readConfig();
  cfg.discord = cfg.discord || {};
  cfg.discord.channels = cfg.discord.channels || {};
  const prev = cfg.discord.channels[key] || {};
  cfg.discord.channels[key] = { ...prev, mode: m, ...(name ? { name: String(name) } : {}) };
  writeConfig(cfg);
  return readDiscordConfig(cfg).channels[key];
}

/** Take a channel off the list. Returns whether it was there. */
export function removeDiscordChannel(id) {
  const key = String(id || "").trim();
  const cfg = readConfig();
  if (!cfg.discord?.channels?.[key]) return false;
  delete cfg.discord.channels[key];
  writeConfig(cfg);
  return true;
}

/**
 * The mode a message is governed by, or null when its room is not listed.
 *
 * A thread inherits its parent's mode unless it is listed itself: a thread
 * opened under #apx-help is part of #apx-help, and making the owner list every
 * thread by hand would mean the bot goes quiet the moment a conversation gets
 * organised.
 */
export function channelModeFor(dc, { channelId, parentId } = {}) {
  const channels = dc?.channels || {};
  if (channelId && channels[channelId]) return channels[channelId].mode;
  if (parentId && channels[parentId]) return channels[parentId].mode;
  return null;
}
