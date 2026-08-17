// The interruption budget — one gate every unrequested message passes through.
//
// THE RULE THAT MATTERS: the gate lives at the CALL SITES that decide to speak
// unprompted, never inside the channel's `_send`. `_send` also carries the
// user's own replies, and a budget that can swallow an answer someone is
// waiting for reads as a hung bot, not as restraint. Each caller states
// `unsolicited` explicitly, so the intent is visible in the diff rather than
// inferred from the call stack.
//
// The budget is a feature, not a limitation: it is what makes the message get
// opened when the agent does speak.
//
// Shape of a call site:
//
//   const gate = canNudge({ kind: "day_open", project_id, severity }, config);
//   if (!gate.allowed) return;                 // log gate.reason
//   await send({ ..., reply_markup: nudgeFeedbackKeyboard(gate.nudge_id) });
//   recordNudge(gate, { chat_id, preview: text });
import { shortId } from "#core/util/ids.js";
import { resolveNudgePolicy, isQuietAt, quietEndsAt } from "./policy.js";
import {
  readNudgeLedger, appendNudge, setNudgeFeedback, nudgesOnDay, lastNudge,
} from "./store.js";

export { resolveNudgePolicy, isQuietAt, DEFAULT_POLICY } from "./policy.js";
export { listNudges, nudgeStats, readNudgeLedger } from "./store.js";

/** Severity that may cross a closed gate, when the policy allows it. */
const CRITICAL = "critical";

/**
 * May APX speak right now?
 *
 * @param {object}  req
 * @param {string}  req.kind          what sort of interruption ("day_open", "signal", "session_result", …)
 * @param {string?} req.project_id    which project it concerns, when it concerns one
 * @param {string}  req.severity      "low" | "normal" | "high" | "critical"
 * @param {boolean} req.unsolicited   false for a delivery the user asked for. Be honest here.
 * @param {boolean} req.scheduled     true when the user themselves put this on the clock (an
 *                                    anchor routine). Exempt from the ceiling, still recorded.
 * @param {string}  req.channel
 * @param {object}  config            parsed ~/.apx/config.json
 * @param {Date}    now               injectable for tests
 * @returns {{allowed: boolean, reason: string, retry_after_ms: number|null, nudge_id: string,
 *            kind: string, project_id: string|null, severity: string, channel: string,
 *            unsolicited: boolean, bypassed_budget: boolean, policy: object}}
 */
export function canNudge(req = {}, config = {}, now = new Date()) {
  const kind = req.kind || "unknown";
  const projectId = req.project_id ?? null;
  const severity = req.severity || "normal";
  const channel = req.channel || "telegram";
  const unsolicited = req.unsolicited !== false;
  const scheduled = req.scheduled === true;
  const policy = resolveNudgePolicy(config);

  const decision = (allowed, reason, retry_after_ms = null, bypassed_budget = false) => ({
    allowed, reason, retry_after_ms,
    nudge_id: shortId("ndg"),
    kind, project_id: projectId, severity, channel, unsolicited, scheduled, bypassed_budget, policy,
  });

  // A reply, or a result the user launched and is waiting for. It passes
  // through so the audit holds and so it lands in the ledger, but it never
  // spends a budget it did not ask to spend.
  if (!unsolicited) return decision(true, "solicited");

  if (!policy.enabled) return decision(true, "budget-disabled");

  // An ANCHOR — the morning and evening messages the user themselves put on
  // the clock. The profile schema calls the daily number "the ceiling OUTSIDE
  // the anchors", and it means it: a budget of three that two anchors spend
  // leaves one, which is not what anybody chose. Charging someone's own
  // schedule against their interruption allowance is the same category of
  // wrong as gating a reply.
  //
  // Quiet hours are skipped too, for the same reason: an anchor scheduled
  // inside them is a contradiction the USER wrote, and their explicit cron
  // beats our default window.
  if (scheduled) return decision(true, "scheduled-by-user");

  const isCritical = severity === CRITICAL;
  if (isCritical && policy.critical_bypasses_budget) {
    // Audited, per the spec: it goes in the ledger flagged, so an integration
    // that discovers "critical" as a way to shout cannot do it quietly.
    return decision(true, "critical-bypass", null, true);
  }

  if (isQuietAt(policy.quiet_hours, now)) {
    const ends = quietEndsAt(policy.quiet_hours, now);
    return decision(false, `quiet-hours (${policy.quiet_hours})`, ends ? ends - now : null);
  }

  const ledger = readNudgeLedger();

  if (policy.daily_max > 0) {
    // Anchors and audited bypasses are recorded but do not consume the
    // allowance — otherwise the number the user configured is not the number
    // they get.
    const today = nudgesOnDay(now, ledger).filter((e) => !e.bypassed_budget && !e.scheduled);
    if (today.length >= policy.daily_max) {
      return decision(
        false,
        `daily budget spent (${today.length}/${policy.daily_max})`,
        msUntilTomorrow(now),
      );
    }
  }

  const cooldowns = [
    [policy.cooldown_minutes, () => true, "global cooldown"],
    [policy.project_cooldown_minutes, (e) => projectId != null && String(e.project_id) === String(projectId), `cooldown for this project`],
    [policy.kind_cooldown_minutes, (e) => e.kind === kind, `cooldown for "${kind}"`],
  ];

  for (const [minutes, match, label] of cooldowns) {
    if (!minutes) continue;
    const last = lastNudge(match, ledger);
    if (!last) continue;
    const elapsed = now - new Date(last.at);
    const window = minutes * 60_000;
    if (Number.isFinite(elapsed) && elapsed < window) {
      return decision(false, `${label} (${minutes}m)`, window - elapsed);
    }
  }

  return decision(true, "within budget");
}

/**
 * Record a nudge that was actually delivered. Takes the decision object
 * `canNudge` returned, so the id in the feedback button and the id in the
 * ledger are the same one.
 */
export function recordNudge(decision, { chat_id = null, preview = "" } = {}) {
  if (!decision?.allowed) return null;
  // Solicited traffic is not an interruption and must not fill the ledger the
  // user reads to answer "how often does this thing bother me".
  if (decision.unsolicited === false) return null;
  return appendNudge({
    id: decision.nudge_id,
    kind: decision.kind,
    project_id: decision.project_id,
    severity: decision.severity,
    channel: decision.channel,
    chat_id,
    preview,
    bypassed_budget: decision.bypassed_budget,
    scheduled: decision.scheduled,
  });
}

/**
 * "That wasn't useful." The loop is not optional: initiative that never learns
 * gets switched off, and the switch is the user muting the bot.
 */
export function recordFeedback(nudgeId, useful, note = "") {
  return setNudgeFeedback(nudgeId, { useful, note });
}

/** Telegram inline keyboard for a proactive push. Two taps, no typing. */
export function nudgeFeedbackKeyboard(nudgeId) {
  if (!nudgeId) return undefined;
  return {
    inline_keyboard: [[
      { text: "👍 Útil", callback_data: `apx:nudge:${nudgeId}:useful` },
      { text: "👎 No me servía", callback_data: `apx:nudge:${nudgeId}:noise` },
    ]],
  };
}

/**
 * Handle a press on that keyboard. Returns the acknowledgement text, or null
 * when the callback belongs to someone else.
 */
export function applyNudgeCallback(data) {
  if (typeof data !== "string" || !data.startsWith("apx:nudge:")) return null;
  const [nudgeId, verb] = data.slice("apx:nudge:".length).split(":");
  if (!nudgeId || (verb !== "useful" && verb !== "noise")) return null;
  const entry = recordFeedback(nudgeId, verb === "useful");
  if (!entry) return { ack: "Ese mensaje ya no está en el registro.", entry: null };
  return {
    ack: verb === "useful" ? "Anotado: te sirvió." : "Anotado: no te servía.",
    entry,
  };
}

function msUntilTomorrow(now) {
  const t = new Date(now);
  t.setHours(24, 0, 0, 0);
  return t - now;
}
