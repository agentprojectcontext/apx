// How many unrequested messages APX may send, and when.
//
// Three layers, lowest precedence first:
//
//   1. CORE DEFAULTS — permissive, and `enabled: false`. Vanilla APX delivers
//      exactly what it delivered before this module existed. Turning a budget
//      on by default would have silently muted push paths people already rely
//      on, which is a regression dressed as a feature.
//   2. THE ACTIVE PROFILE — a profile that declares `nudge_budget_per_day` or
//      `quiet_hours` is stating a criterion, and switches enforcement ON. This
//      is the split the whole profile subsystem rests on: core owns the
//      capability (a gate, a ledger, a feedback loop), the profile owns the
//      judgement (three a day, quiet after ten).
//   3. THE USER — `config.nudge` in ~/.apx/config.json, written by the panel or
//      by hand. Always wins. Someone who sets a number should get that number
//      whatever profile they install later.
import { readActiveProfile, effectiveProfileConfig } from "#core/profiles/store.js";

/** Permissive on purpose — see the header. */
export const DEFAULT_POLICY = Object.freeze({
  enabled: false,
  daily_max: 0,               // 0 = no ceiling
  quiet_hours: "",            // "" = never quiet
  cooldown_minutes: 0,        // between any two nudges
  project_cooldown_minutes: 0, // between two nudges about the SAME project
  kind_cooldown_minutes: 0,   // between two nudges of the SAME kind
  critical_bypasses_budget: true,
});

/**
 * Profile config keys this module understands. Deliberately generic names: a
 * chief-of-staff profile and a study-tutor profile both mean the same thing by
 * "how often may you interrupt me". A profile that declares neither key leaves
 * the gate off.
 */
const PROFILE_KEYS = Object.freeze({
  nudge_budget_per_day: "daily_max",
  quiet_hours: "quiet_hours",
  nudge_cooldown_minutes: "cooldown_minutes",
  nudge_project_cooldown_minutes: "project_cooldown_minutes",
  nudge_kind_cooldown_minutes: "kind_cooldown_minutes",
});

/**
 * Resolve the effective policy for the current config.
 *
 * @param {object} config  the parsed ~/.apx/config.json
 * @returns {typeof DEFAULT_POLICY & { source: string[] }}
 */
export function resolveNudgePolicy(config = {}) {
  const policy = { ...DEFAULT_POLICY };
  const source = ["defaults"];

  // ── layer 2: the active profile ──────────────────────────────────────────
  let profileConfig = null;
  try {
    const active = readActiveProfile(config);
    if (active) profileConfig = effectiveProfileConfig(active, config);
  } catch {
    // A broken or half-installed profile must not take the gate down with it.
    profileConfig = null;
  }

  if (profileConfig) {
    let touched = false;
    for (const [profileKey, policyKey] of Object.entries(PROFILE_KEYS)) {
      const v = profileConfig[profileKey];
      if (v === undefined || v === null || v === "") continue;
      policy[policyKey] = v;
      touched = true;
    }
    // Declaring a budget IS opting in. A profile that says "three a day" and
    // then gets ignored because a separate flag was off is worse than useless.
    if (touched) {
      policy.enabled = true;
      source.push("profile");
    }
  }

  // ── layer 3: the user ────────────────────────────────────────────────────
  const user = config?.nudge;
  if (user && typeof user === "object") {
    let touched = false;
    for (const key of Object.keys(DEFAULT_POLICY)) {
      if (user[key] === undefined || user[key] === null) continue;
      policy[key] = user[key];
      touched = true;
    }
    if (touched) source.push("user");
  }

  policy.daily_max = toNonNegativeInt(policy.daily_max);
  policy.cooldown_minutes = toNonNegativeInt(policy.cooldown_minutes);
  policy.project_cooldown_minutes = toNonNegativeInt(policy.project_cooldown_minutes);
  policy.kind_cooldown_minutes = toNonNegativeInt(policy.kind_cooldown_minutes);
  policy.enabled = policy.enabled === true;
  policy.critical_bypasses_budget = policy.critical_bypasses_budget !== false;
  policy.quiet_hours = typeof policy.quiet_hours === "string" ? policy.quiet_hours.trim() : "";

  return { ...policy, source };
}

function toNonNegativeInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse a "HH:MM-HH:MM" window into minutes-from-midnight.
 * Returns null when the string is absent or unparseable — an unreadable window
 * must not accidentally mean "always quiet".
 */
export function parseQuietHours(spec) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(String(spec || ""));
  if (!m) return null;
  const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  return { start: h1 * 60 + m1, end: h2 * 60 + m2 };
}

/**
 * Is `date` inside the quiet window? Handles windows that cross midnight,
 * which is the normal case for sleep ("22:00-07:30").
 */
export function isQuietAt(spec, date = new Date()) {
  const w = parseQuietHours(spec);
  if (!w) return false;
  const mins = date.getHours() * 60 + date.getMinutes();
  if (w.start === w.end) return false;               // zero-width window
  if (w.start < w.end) return mins >= w.start && mins < w.end;
  return mins >= w.start || mins < w.end;            // crosses midnight
}

/** When does the current quiet window end? Null when not quiet. */
export function quietEndsAt(spec, date = new Date()) {
  if (!isQuietAt(spec, date)) return null;
  const w = parseQuietHours(spec);
  const end = new Date(date);
  end.setSeconds(0, 0);
  end.setHours(Math.floor(w.end / 60), w.end % 60);
  if (end <= date) end.setDate(end.getDate() + 1);
  return end;
}
