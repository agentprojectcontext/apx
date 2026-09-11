// The executive layer's policy: the four rituals, and the thresholds that
// decide how often a company may interrupt its owner.
//
// These are settings, not constants, because "how often am I willing to be
// interrupted" is a decision and it belongs where it can be read and changed.
// They arrive from the project's profile config; the defaults here are what a
// company gets before anybody tunes anything.

/**
 * Each ritual is a different QUESTION, which is why each is its own routine
 * rather than one review with a mode flag. A prompt that tries to answer all
 * four produces the inventory nobody reads.
 *
 * `maxLines` is the rubric's cap: the daily pulse has to be shorter still or
 * it stops being a pulse. `hour` has to fall outside quiet hours or the guard
 * holds every single run and the layer looks dead.
 */
export const RITUALS = {
  daily: { slug: "daily", label: "Daily pulse", severity: "fyi", maxLines: 8, hour: 8 },
  weekly: { slug: "weekly", label: "Weekly review", severity: "status", maxLines: 15, hour: 9 },
  biweekly: { slug: "biweekly", label: "Decision brief", severity: "status", maxLines: 15, hour: 12 },
  monthly: { slug: "monthly", label: "Business scorecard", severity: "status", maxLines: 20, hour: 9 },
};

export const SEVERITIES = ["blocker", "status", "fyi"];

export const DEFAULT_POLICY = {
  /** Local hours during which only a blocker may wake anybody. */
  quietHours: { from: 22, to: 8 },
  /** How far back an identical brief still counts as already said. */
  dedupWindowHours: { default: 168, blocker: 6 },
  /** One delivery per ritual per this many hours. */
  ritualCooldownHours: 20,
  /** Deliveries from the whole layer in a rolling 7 days. A blocker is free. */
  weeklyCap: 4,
  /** Hard cap on a brief so a digest stays readable on a phone. */
  maxBriefChars: 2000,
  timezone: "America/Argentina/Buenos_Aires",
  /** Where the ledger lives, relative to the project root. */
  ledgerPath: "work/exec/DECISIONS.md",
  /** The agent that writes the briefs — the project's orchestrator. */
  agent: "ceo",
};

/** "22-8" → {from: 22, to: 8}. A malformed value keeps the default. */
function parseQuietHours(raw, fallback) {
  const m = String(raw ?? "").match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  if (!m) return fallback;
  const from = Number(m[1]) % 24;
  const to = Number(m[2]) % 24;
  return { from, to };
}

/**
 * Turn a profile's settings into the policy the guard runs on.
 * Unknown or missing settings fall back rather than throwing: a typo in a
 * setting must not stop the layer from running, only from being tuned.
 */
export function policyFrom(settings = {}) {
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    ...DEFAULT_POLICY,
    quietHours: parseQuietHours(settings.quiet_hours, DEFAULT_POLICY.quietHours),
    weeklyCap: num(settings.weekly_deliveries, DEFAULT_POLICY.weeklyCap),
    dedupWindowHours: {
      default: num(settings.dedup_window_hours, DEFAULT_POLICY.dedupWindowHours.default),
      blocker: DEFAULT_POLICY.dedupWindowHours.blocker,
    },
    ledgerPath: settings.ledger_path || DEFAULT_POLICY.ledgerPath,
    agent: settings.orchestrator_agent || DEFAULT_POLICY.agent,
    timezone: settings.timezone || DEFAULT_POLICY.timezone,
  };
}

export function ritualOrThrow(ritual) {
  const definition = RITUALS[ritual];
  if (!definition) {
    throw new Error(`unknown ritual: ${ritual} — known: ${Object.keys(RITUALS).join(", ")}`);
  }
  return definition;
}
