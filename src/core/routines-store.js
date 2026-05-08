// File-based routines store: read/write .apc/routines.json.
// Replaces the SQLite `routines` table for project-scoped scheduled tasks.
import fs from "node:fs";
import path from "node:path";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const isoToMs = (iso) => (iso ? Date.parse(iso) : 0);

function routinesPath(projectPath) {
  return path.join(projectPath, ".apc", "routines.json");
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
  return { kind: "invalid" };
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
  return null;
}

// --------------------- CRUD -------------------------------------------------

export function listRoutines(projectPath) {
  return readFile(projectPath);
}

export function getRoutine(projectPath, name) {
  return readFile(projectPath).find((r) => r.name === name) || null;
}

export function upsertRoutine(projectPath, { name, kind, schedule, spec, enabled = true }) {
  if (!name || !kind || !schedule) throw new Error("routine requires name, kind, schedule");
  const now = nowIso();
  const routines = readFile(projectPath);
  const idx = routines.findIndex((r) => r.name === name);
  const prev = idx >= 0 ? routines[idx] : null;
  const next = computeNextRun({ schedule, last_run_at: null });
  const entry = {
    name,
    kind,
    schedule,
    spec: spec || {},
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
  writeFile(projectPath, routines);
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
  return readFile(projectPath).filter(
    (r) => r.enabled && (!r.next_run_at || r.next_run_at <= nowStr)
  );
}
