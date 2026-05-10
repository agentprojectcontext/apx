// File-based routines store: read/write .apc/routines.json.
// Replaces the SQLite `routines` table for project-scoped scheduled tasks.
import fs from "node:fs";
import path from "node:path";
import cronParser from "cron-parser";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const isoToMs = (iso) => (iso ? Date.parse(iso) : 0);

function routinesPath(storagePath) {
  // storagePath is always ~/.apx/projects/{apxId}/ — flat, no .apc subdir needed.
  return path.join(storagePath, "routines.json");
}

function readFile(projectPath) {
  const p = routinesPath(projectPath);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(raw.routines) ? raw.routines : [];
  } catch {
    return [];
  }
}

function writeFile(projectPath, routines) {
  const p = routinesPath(projectPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ routines }, null, 2) + "\n");
}

// --------------------- schedule parsing -------------------------------------

export function parseSchedule(s, baseMs = Date.now()) {
  if (!s || typeof s !== "string") return { kind: "invalid" };
  
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
    const interval = cronParser.parseExpression(s, { currentDate: new Date(baseMs) });
    return { kind: "cron", parser: interval };
  } catch (err) {
    return { kind: "invalid" };
  }
}

export function computeNextRun(routine, baseMs = Date.now()) {
  const sched = parseSchedule(routine.schedule, baseMs);
  if (sched.kind === "invalid") return null;
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

export function upsertRoutine(storagePath, { name, kind, schedule, spec, enabled = true, permission_mode, allowed_tools, pre_commands, post_commands, skip_prompt_on }) {
  if (!name || !kind || !schedule) throw new Error("routine requires name, kind, schedule");
  const now = nowIso();
  const routines = readFile(storagePath);
  const idx = routines.findIndex((r) => r.name === name);
  const prev = idx >= 0 ? routines[idx] : null;
  const next = computeNextRun({ schedule, last_run_at: null });
  const entry = {
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
    if (parseSchedule(r.schedule).kind === "invalid") return false;
    return (!r.next_run_at || r.next_run_at <= nowStr);
  });
}
