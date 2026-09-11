// The outbound guard.
//
// A periodic agent that may interrupt its owner needs three brakes, and none
// of them can live in the prompt, because a prompt is advice and this has to
// be a rule:
//
//   dedup     — the same finding, said twice, teaches the owner to stop reading.
//   rate cap  — four interruptions a week from one layer is already a lot.
//   quiet     — nothing but a blocker crosses the night.
//
// The guard decides; it never sends. `send`, `hold` and `drop` are the three
// answers, and every one of them is recorded, so a quiet week is legible as a
// quiet week instead of as a layer that stopped working.
import { createHash } from "node:crypto";
import { DEFAULT_POLICY, SEVERITIES, ritualOrThrow } from "./policy.js";

/**
 * A stable identity for "this finding, again".
 *
 * Dates are collapsed, because the same risk reported on Monday and on Tuesday
 * is the same risk. Numbers are NOT: "2 tasks overdue" and "7 tasks overdue"
 * are different news and both deserve to be delivered.
 */
export function fingerprint(brief) {
  const normalized = String(brief ?? "")
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}(?:t[\d:.]+z?)?/g, "<date>")
    .replace(/\b\d{1,2}[-/](?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\b/g, "<date>")
    .replace(/\b\d{1,2}[-/](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, "<date>")
    .replace(/[*_`>#[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

export function localHour(now = new Date(), timeZone = DEFAULT_POLICY.timezone) {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now);
  // `24` is midnight in some ICU versions; normalise it to 0.
  return Number(hour) % 24;
}

export function isQuietHour(now = new Date(), policy = DEFAULT_POLICY) {
  const { from, to } = policy.quietHours || DEFAULT_POLICY.quietHours;
  const hour = localHour(now, policy.timezone);
  // The window wraps midnight, so "22 to 8" is two ranges, not one.
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

/**
 * An explicit severity the agent put on its own brief.
 *
 * It has no channel of its own, so escalation has to be something it can SAY.
 * A first line of `SEVERITY: blocker` is that, and it is stripped from the body
 * so it never reaches the owner as noise. The Spanish spelling is accepted
 * because the agents that write these briefs are often writing in Spanish.
 */
export function parseSeverity(brief, fallback = "status") {
  const text = String(brief ?? "");
  const match = text.match(/^[ \t]*SEVERI(?:TY|DAD)[ \t]*:[ \t]*(blocker|status|fyi)[ \t]*\r?\n?/i);
  if (!match) return { severity: fallback, body: text.trim() };
  return { severity: match[1].toLowerCase(), body: text.slice(match[0].length).trim() };
}

export function isNoMessage(brief) {
  return /^\s*NO_MESSAGE\b/i.test(String(brief ?? ""));
}

const hoursBetween = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3_600_000;

/**
 * Decide what happens to a brief.
 * @returns {{action:"send"|"hold"|"drop", reason:string, hash:string, severity:string, body:string}}
 */
export function decide({ brief, ritual, now = new Date(), history = [], policy = DEFAULT_POLICY }) {
  const definition = ritualOrThrow(ritual);
  const { severity, body } = parseSeverity(brief, definition.severity);
  if (!SEVERITIES.includes(severity)) throw new Error(`unknown severity: ${severity}`);

  const hash = fingerprint(body);
  const verdict = (action, reason) => ({ action, reason, hash, severity, body });

  if (!body) return verdict("drop", "The brief came back empty: there is nothing to deliver.");
  if (isNoMessage(body)) return verdict("drop", "NO_MESSAGE: the run found nothing worth interrupting for.");

  const delivered = history.filter((e) => e?.action === "send" && e?.at);
  const isBlocker = severity === "blocker";
  const window = isBlocker ? policy.dedupWindowHours.blocker : policy.dedupWindowHours.default;
  const duplicate = delivered.find((e) => e.hash === hash && hoursBetween(e.at, now) <= window);

  if (duplicate) {
    return verdict("drop", `Duplicate: the same was delivered on ${new Date(duplicate.at).toISOString().slice(0, 16)}Z.`);
  }
  // A blocker crosses the night and the cap. That is what the word is for, and
  // it is why the rubric makes the agent justify it.
  if (isBlocker) return verdict("send", "Blocker: delivered without waiting for a window or a quota.");
  if (isQuietHour(now, policy)) {
    return verdict("hold", "Quiet hours: recorded, and delivered on the next run inside the window.");
  }

  const sameRitual = delivered.find(
    (e) => e.ritual === ritual && hoursBetween(e.at, now) < policy.ritualCooldownHours,
  );
  if (sameRitual) return verdict("hold", `Cooldown on ${ritual}: already delivered less than ${policy.ritualCooldownHours}h ago.`);

  const lastWeek = delivered.filter((e) => hoursBetween(e.at, now) <= 168);
  if (lastWeek.length >= policy.weeklyCap) {
    return verdict("hold", `Weekly quota spent (${lastWeek.length}/${policy.weeklyCap}): only a blocker gets through.`);
  }
  return verdict("send", `Inside the window and the quota (${lastWeek.length}/${policy.weeklyCap} this week).`);
}

/** What the guard would say about the budget right now, for the context block. */
export function budget({ now = new Date(), history = [], policy = DEFAULT_POLICY } = {}) {
  const delivered = history.filter((e) => e?.action === "send" && e?.at);
  const lastWeek = delivered.filter((e) => hoursBetween(e.at, now) <= 168);
  const last = delivered.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).at(0);
  return {
    used: lastWeek.length,
    cap: policy.weeklyCap,
    quiet: isQuietHour(now, policy),
    lastDeliveryAt: last?.at ?? null,
    lastRitual: last?.ritual ?? null,
  };
}
