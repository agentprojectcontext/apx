// File-based routines store: read/write .apc/routines.json.
// Replaces the SQLite `routines` table for project-scoped scheduled tasks.
import path from "node:path";
import { CronExpressionParser } from "cron-parser";
import { nowIso, isoToMs } from "../util/time.js";
import { shortId } from "../util/ids.js";
import { readJson, writeJson } from "#core/util/json-file.js";

function routinesPath(storagePath) {
  // storagePath is always ~/.apx/projects/{apxId}/ — flat, no .apc subdir needed.
  return path.join(storagePath, "routines.json");
}

function readFile(projectPath) {
  const raw = readJson(routinesPath(projectPath), {});
  return Array.isArray(raw?.routines) ? raw.routines : [];
}

// Atomic: a crash mid-write used to leave a truncated routines.json, and since
// the reader swallows parse errors the next read reported "no routines".
function writeFile(projectPath, routines) {
  writeJson(routinesPath(projectPath), { routines });
}

// --------------------- schedule parsing -------------------------------------

export function parseSchedule(s, baseMs = Date.now()) {
  if (!s || typeof s !== "string") return { kind: "invalid" };

  // "manual" — runs only when someone runs it. It USED to work by accident:
  // the string failed cron parsing, came back "invalid", and an invalid
  // schedule never becomes due. Correct outcome, wrong reason, and it meant
  // every surface reported a deliberate choice as a broken expression.
  if (s.trim().toLowerCase() === "manual") return { kind: "manual" };

  // Tolerate a leading "cron " label. The web editor's own presets wrote
  // `cron 0 9 * * *`, which cron-parser rejects — so picking "daily at 9am"
  // in the panel produced a routine that never ran, with nothing to show why.
  const labelled = s.trim().replace(/^cron\s+/i, "");
  
  if (s.startsWith("every:")) {
    const spec = s.slice(6).trim();
    const m = spec.match(/^(\d+)(s|m|h|d)$/);
    if (!m) return { kind: "invalid" };
    const n = parseInt(m[1], 10);
    const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
    return { kind: "every", intervalMs: n * mult };
  }
  
  if (s.startsWith("once:")) {
    const ts = s.slice(5).trim();
    const ms = Date.parse(ts);
    if (isNaN(ms)) return { kind: "invalid" };
    return { kind: "once", atMs: ms };
  }

  // Fallback: Try parsing as standard cron expression using cron-parser
  try {
    const interval = CronExpressionParser.parse(labelled, { currentDate: new Date(baseMs) });
    return { kind: "cron", parser: interval };
  } catch (err) {
    return { kind: "invalid" };
  }
}

export function computeNextRun(routine, baseMs = Date.now()) {
  const sched = parseSchedule(routine.schedule, baseMs);
  if (sched.kind === "invalid" || sched.kind === "manual") return null;
  if (sched.kind === "once") {
    return sched.atMs > baseMs
      ? new Date(sched.atMs).toISOString().replace(/\.\d{3}Z$/, "Z")
      : null;
  }
  if (sched.kind === "every") {
    const last = isoToMs(routine.last_run_at);
    const next = (last || baseMs) + sched.intervalMs;
    const target = next < baseMs ? baseMs + 100 : next;
    return new Date(target).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (sched.kind === "cron") {
    try {
      const nextDate = sched.parser.next();
      return nextDate.toISOString().replace(/\.\d{3}Z$/, "Z");
    } catch (err) {
      return null;
    }
  }
  return null;
}

// --------------------- CRUD -------------------------------------------------

export function listRoutines(projectPath) {
  return readFile(projectPath);
}

export function getRoutine(projectPath, name) {
  return readFile(projectPath).find((r) => r.name === name) || null;
}

export function upsertRoutine(storagePath, { name, kind, schedule, spec, enabled = true, permission_mode, allowed_tools, pre_commands, post_commands, skip_prompt_on, deliver_to, origin, origin_hash }) {
  if (!name || !kind || !schedule) throw new Error("routine requires name, kind, schedule");
  const now = nowIso();
  const routines = readFile(storagePath);
  const idx = routines.findIndex((r) => r.name === name);
  const prev = idx >= 0 ? routines[idx] : null;
  const next = computeNextRun({ schedule, last_run_at: null });
  const entry = {
    // `entry` is rebuilt from scratch on every upsert, so the id MUST be
    // carried over explicitly (same as created_at below). Dropping it here
    // would re-id the routine on every edit and orphan its memory directory.
    id: prev?.id || shortId("r"),
    name,
    kind,
    schedule,
    spec: spec || {},
    permission_mode: permission_mode || prev?.permission_mode || null,
    allowed_tools: Array.isArray(allowed_tools) ? allowed_tools : (prev?.allowed_tools || []),
    // Pipeline fields
    pre_commands: Array.isArray(pre_commands) ? pre_commands : (prev?.pre_commands || []),
    post_commands: Array.isArray(post_commands) ? post_commands : (prev?.post_commands || []),
    // When to skip phase 2 (the LLM call):
    //   "signal"      — (default) skip if APX_SKIP found in pre_commands stdout
    //   "pre_failure" — skip if any pre_command exits != 0
    //   "pre_success" — skip if all pre_commands exit 0
    //   "always"      — never run the LLM (shell-only routine)
    //   "never"       — always run the LLM regardless of pre_commands
    skip_prompt_on: skip_prompt_on || prev?.skip_prompt_on || "signal",
    // Where the run's output is delivered (core/routines/delivery.js).
    // `null` and `[]` are NOT the same value here, and this is the one place
    // that has to keep them apart: `null` means "nobody said", so the
    // deployment default still applies, while `[]` means "deliver nowhere" and
    // stops the fallthrough. Defaulting an absent field to `[]` is exactly the
    // bug allowed_tools had — every routine created the obvious way silently
    // carried a deliberate-looking empty list nobody wrote.
    deliver_to: Array.isArray(deliver_to) ? deliver_to : (deliver_to === null ? null : (prev?.deliver_to ?? null)),
    // Provenance. A routine installed by a persona package carries
    // origin: "persona:<id>" so it can be disabled or removed with that
    // package without touching the user's own routines. `origin_hash` is the
    // hash of the spec as the package rendered it: when the record no longer
    // matches, the user has edited it and the package must never overwrite or
    // delete it again.
    origin: origin ?? prev?.origin ?? null,
    origin_hash: origin_hash ?? prev?.origin_hash ?? null,
    enabled: enabled !== false,
    last_run_at: prev?.last_run_at ?? null,
    last_status: prev?.last_status ?? null,
    last_error: prev?.last_error ?? null,
    next_run_at: next,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  };
  if (idx >= 0) {
    routines[idx] = entry;
  } else {
    routines.push(entry);
  }
  writeFile(storagePath, routines);
  return entry;
}

// Repoint every routine that targets `oldSlug` to `newSlug`. Called when an
// agent is renamed so its scheduled tasks don't silently point at a slug that
// no longer exists. Returns the number of routines rewritten.
export function renameRoutineAgent(storagePath, oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return 0;
  const routines = readFile(storagePath);
  let changed = 0;
  for (const r of routines) {
    if (r?.spec && r.spec.agent === oldSlug) {
      r.spec = { ...r.spec, agent: newSlug };
      r.updated_at = nowIso();
      changed += 1;
    }
  }
  if (changed) writeFile(storagePath, routines);
  return changed;
}

export function deleteRoutine(projectPath, name) {
  const routines = readFile(projectPath);
  const idx = routines.findIndex((r) => r.name === name);
  if (idx === -1) return false;
  routines.splice(idx, 1);
  writeFile(projectPath, routines);
  return true;
}

export function setEnabled(projectPath, name, enabled) {
  const routines = readFile(projectPath);
  const r = routines.find((x) => x.name === name);
  if (!r) return false;
  r.enabled = !!enabled;
  r.updated_at = nowIso();
  writeFile(projectPath, routines);
  return true;
}

export function updateRunState(projectPath, name, { last_run_at, last_status, last_error, next_run_at, disable = false }) {
  const routines = readFile(projectPath);
  const r = routines.find((x) => x.name === name);
  if (!r) return false;
  r.last_run_at = last_run_at;
  r.last_status = last_status;
  r.last_error = last_error || null;
  r.next_run_at = next_run_at;
  r.updated_at = last_run_at || nowIso();
  if (disable) r.enabled = false;
  writeFile(projectPath, routines);
  return true;
}

export function getDueRoutines(projectPath, nowStr) {
  return readFile(projectPath).filter((r) => {
    if (!r.enabled) return false;
    // CRITICAL: If the schedule cannot be parsed, NEVER run it.
    // Otherwise, an invalid schedule (like a cron string) sets next_run_at to null,
    // which previously caused it to be considered ALWAYS due and spam execution every 5 seconds!
    const kind = parseSchedule(r.schedule).kind;
    // "manual" is a deliberate never-on-a-clock, not a broken expression —
    // both are skipped here, but only one of them is a problem to report.
    if (kind === "invalid" || kind === "manual") return false;
    return (!r.next_run_at || r.next_run_at <= nowStr);
  });
}
