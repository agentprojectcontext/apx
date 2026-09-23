// A provider account that has run OUT, as opposed to one that is busy.
//
// Both answer 429, and the retry classifier (retry.js) rightly treats a 429 as
// "try the next model". For a burst — zen's "Rate limit exceeded", Gemini's
// "high demand" — that is correct: the next request a minute later works. For
// an exhausted plan it is the opposite of correct. On 2026-09-23 the ChatGPT
// subscription hit "The usage limit has been reached" at 08:46 while ~230 a2a
// turns were in flight, and every one of them walked the chain: Gemini (503),
// Ollama cloud (its own monthly limit, also spent), then the local model. No
// turn stopped, nobody was told, and the owner found out by reading Telegram.
//
// So an exhausted account gets two treatments the busy one does not:
//
//   1. It COOLS DOWN. For a while every router lookup skips it instead of
//      paying one failed call per turn to rediscover that it is empty.
//   2. A turn nobody is watching — an a2a reply, a routine — STOPS rather than
//      spending the fallback chain. A person in a chat still falls through to
//      the next model: they are there, they asked, and they can see it.
//
// In-memory on purpose: a daemon restart forgets the cooldown, which costs one
// failed call to relearn it — cheaper than a persisted verdict that outlives
// the plan's reset.
import { CHANNELS } from "#core/constants/channels.js";

// Phrases that mean "this account's allowance is spent", as the providers in
// use actually word it. A plain "rate limit" is deliberately absent: that is
// the busy case, and it must keep rotating.
const QUOTA_PHRASES = [
  /usage limit (has been )?reached/i,
  /reached your (monthly|daily|weekly)? ?usage limit/i,
  /insufficient[_ ]quota/i,
  /exceeded your current quota/i,
  /quota (has been )?exceeded/i,
  /billing (hard )?limit/i,
];

/** Default cooldown. Plans reset on windows from hours to a month; an hour
 *  bounds how long a recovered account sits unused, and a still-empty one
 *  costs a single failed call to re-cool. */
export const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

/** Surfaces with no human watching the turn. */
const AUTONOMOUS_CHANNELS = new Set([CHANNELS.A2A, CHANNELS.ROUTINE]);

const cooled = new Map(); // modelId → { until, reason, noticed }

export function isQuotaExhaustedError(err) {
  const msg = String(err?.message || err || "");
  return QUOTA_PHRASES.some((re) => re.test(msg));
}

export function isAutonomousChannel(channel) {
  return AUTONOMOUS_CHANNELS.has(channel);
}

function cooldownMs(config) {
  const min = Number(config?.super_agent?.quota_cooldown_min);
  return Number.isFinite(min) && min > 0 ? min * 60 * 1000 : QUOTA_COOLDOWN_MS;
}

/** Record that `modelId`'s account is spent. */
export function markQuotaExhausted(modelId, err, { config = null, now = Date.now() } = {}) {
  if (!modelId) return;
  const prev = cooled.get(modelId);
  cooled.set(modelId, {
    until: now + cooldownMs(config),
    reason: String(err?.message || err || "quota exhausted").slice(0, 200),
    // Kept across re-marks inside one window, so the owner hears about an
    // empty account once — not once per routine that trips over it.
    noticed: prev && prev.until > now ? prev.noticed : false,
  });
}

/** `{ until, reason }` while `modelId` is cooling down, else null. */
export function quotaCooldown(modelId, { now = Date.now() } = {}) {
  const c = cooled.get(modelId);
  if (!c) return null;
  if (c.until <= now) {
    cooled.delete(modelId);
    return null;
  }
  return { until: c.until, reason: c.reason };
}

/**
 * True exactly once per cooldown window per model: the caller that gets true
 * is the one that tells the owner.
 */
export function claimQuotaNotice(modelId, { now = Date.now() } = {}) {
  const c = cooled.get(modelId);
  if (!c || c.until <= now || c.noticed) return false;
  c.noticed = true;
  return true;
}

/** The error an autonomous turn stops with. Tagged so callers can tell it
 *  from an ordinary failure without parsing prose. */
export function quotaStopError(modelId, reason, until) {
  const at = until ? new Date(until).toISOString().slice(11, 16) : null;
  const err = new Error(
    `${modelId}: the account's usage limit is spent (${reason}). ` +
    `This turn has no one watching it, so it stops here instead of spending the other providers` +
    (at ? `; ${modelId} is skipped until ${at} UTC.` : "."),
  );
  err.code = "QUOTA_EXHAUSTED";
  err.modelId = modelId;
  err.retryable = false;
  return err;
}

/** Test seam. */
export function _resetQuotaCooldowns() {
  cooled.clear();
}
