// Discord: may this message be stored, and may it be answered?
//
// Settled by code, before any model sees the message — the same rule as the
// WhatsApp dispatcher. "Should I speak here" is never a judgement the model
// makes about text that may be trying to talk it into speaking.
//
// Two questions, deliberately separate:
//
//   store  — does this message enter the ledger (and so the summary and the
//            RAG)? Yes for every non-empty message in a listed room, whoever
//            wrote it, including other bots. No for an unlisted room: it does
//            not exist for us.
//   reply  — does it start a turn? That is the mode, then the limits.
//
// The limits live here too, because a message that is refused by a limit is a
// message that costs nothing. The expensive thing in a busy room is not reading
// — Discord delivers every message whether we want it or not — it is calling a
// model, and this is the one place that decides whether that happens.
import { DISCORD_MODES, channelModeFor } from "./config.js";

export const SKIP_REASONS = Object.freeze({
  NOT_LISTED: "channel_not_listed",
  EMPTY: "empty",
  OWN: "own_message",
  BOT: "bot_author",
  READ_ONLY: "read_only_channel",
  NOT_CALLED: "not_called",
  COOLDOWN: "user_cooldown",
  CHANNEL_CAP: "channel_cap",
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Was the bot called by this message?
 *
 * Three ways, and only these: an @mention of the bot, a reply to one of its
 * messages, or one of its names as a whole word ("roby, qué pensás?"). An
 * @everyone is not a call — it is somebody shouting at the room, and a bot that
 * answers every @everyone is the bot everybody mutes.
 */
export function isCalled(msg, { botId, names = [] } = {}) {
  if (!msg) return false;
  if (botId && Array.isArray(msg.mentions) && msg.mentions.includes(botId)) return true;
  if (botId && msg.reply_to?.author_id === botId) return true;
  const text = String(msg.content || "").toLowerCase();
  for (const n of names) {
    if (!n) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(n)}([^\\p{L}\\p{N}_]|$)`, "u").test(text)) return true;
  }
  return false;
}

/**
 * Per-user cooldowns and a per-room hourly ceiling, in memory.
 *
 * In memory on purpose: a restart forgetting who was answered a minute ago
 * costs at most one extra reply, and persisting a rate limiter to disk buys
 * nothing but a file to corrupt. `now` is injectable so tests do not sleep.
 */
export function createDiscordLimiter({ now = () => Date.now() } = {}) {
  const lastReplyTo = new Map(); // channel|user → ms
  const repliesIn = new Map();   // channel → [ms, …] within the last hour

  function recent(channelId, t) {
    const list = (repliesIn.get(channelId) || []).filter((x) => t - x < 3_600_000);
    repliesIn.set(channelId, list);
    return list;
  }

  return {
    /** Would a reply be allowed right now? Does not record anything. */
    check({ channelId, userId, limits }) {
      const t = now();
      const last = lastReplyTo.get(`${channelId}|${userId}`);
      if (last !== undefined && t - last < limits.user_cooldown_ms) {
        return { ok: false, reason: SKIP_REASONS.COOLDOWN };
      }
      if (recent(channelId, t).length >= limits.channel_replies_per_hour) {
        return { ok: false, reason: SKIP_REASONS.CHANNEL_CAP };
      }
      return { ok: true };
    },
    /** A reply was sent (or is about to be): start the clocks. */
    record({ channelId, userId }) {
      const t = now();
      lastReplyTo.set(`${channelId}|${userId}`, t);
      recent(channelId, t).push(t);
    },
    /** How many replies a room has had this hour. For status lines. */
    usedThisHour(channelId) {
      return recent(channelId, now()).length;
    },
  };
}

/**
 * The whole decision for one inbound message.
 *
 * Returns `{ store, reply, mode, called, reason }`. `reason` names why a reply
 * did NOT happen, so the daemon log can say it in one line instead of the owner
 * having to guess why the bot was quiet.
 *
 * The owner is not exempt from the mode: a room set to `mention` is a room
 * where the bot speaks when called, whoever is in it. The owner IS exempt from
 * the limits — a limit exists to protect the owner's budget from other people.
 */
export function decideDiscordMessage(msg, { dc, botId, limiter } = {}) {
  const mode = channelModeFor(dc, { channelId: msg?.channel_id, parentId: msg?.parent_id });
  const base = { store: false, reply: false, mode, called: false };
  if (!mode) return { ...base, reason: SKIP_REASONS.NOT_LISTED };
  if (msg.author?.id && botId && msg.author.id === botId) return { ...base, reason: SKIP_REASONS.OWN };
  const text = String(msg.content || "").trim();
  if (!text) return { ...base, reason: SKIP_REASONS.EMPTY };

  const stored = { ...base, store: true };
  // Another bot's message is part of the room — worth remembering, never worth
  // answering. Two bots answering each other is the classic way to spend a
  // month's budget in an afternoon.
  if (msg.author?.bot) return { ...stored, reason: SKIP_REASONS.BOT };
  if (mode === DISCORD_MODES.READ) return { ...stored, reason: SKIP_REASONS.READ_ONLY };

  const called = isCalled(msg, { botId, names: dc?.names || [] });
  if (mode === DISCORD_MODES.MENTION && !called) {
    return { ...stored, called, reason: SKIP_REASONS.NOT_CALLED };
  }

  const isOwner = (dc?.owner_ids || []).includes(msg.author?.id);
  if (!isOwner && limiter) {
    const gate = limiter.check({ channelId: msg.channel_id, userId: msg.author?.id, limits: dc.limits });
    if (!gate.ok) return { ...stored, called, reason: gate.reason };
  }
  return { ...stored, reply: true, called, reason: null };
}
