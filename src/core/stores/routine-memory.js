// Per-routine memory.md — durable notes scoped to a single routine.
//
// Path: <projectStoragePath>/routines/<routineId>/memory.md
//
// The routine handler (core/routines/runner.js) creates the file on first read
// and injects a bounded slice into the super-agent prompt via
// channelMeta.routineMemory. The routine can write back with future tooling;
// today we only read.
//
// Distinct from:
//   - Agent memory (~/.apx/projects/<id>/agents/<slug>/memory.md) — per-agent.
//   - Super-agent self-memory (~/.apx/memory.md) — global to the super-agent.
import fs from "node:fs";
import path from "node:path";

const PROMPT_LIMIT = 1500;

export function routineMemoryDir(storagePath, routineId) {
  return path.join(storagePath, "routines", String(routineId || "_unknown"));
}

export function routineMemoryPath(storagePath, routineId) {
  return path.join(routineMemoryDir(storagePath, routineId), "memory.md");
}

/** Read the memory body. Returns "" when the file doesn't exist. Never throws. */
export function readRoutineMemory(storagePath, routineId) {
  try {
    return fs.readFileSync(routineMemoryPath(storagePath, routineId), "utf8");
  } catch {
    return "";
  }
}

/** Bounded slice for the system prompt. Returns "" when empty. */
export function readRoutineMemoryForPrompt(storagePath, routineId, limit = PROMPT_LIMIT) {
  const body = readRoutineMemory(storagePath, routineId).trim();
  if (!body) return "";
  if (body.length <= limit) return body;
  return body.slice(0, limit).trimEnd() + "\n… (truncated)";
}

/** Ensure the routine memory file exists. Returns true if it was created. */
export function ensureRoutineMemory(storagePath, routineId, routineName = "") {
  const file = routineMemoryPath(storagePath, routineId);
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = routineName
    ? `# Routine memory — ${routineName}\n`
    : "# Routine memory\n";
  fs.writeFileSync(file, header);
  return true;
}

/** Append a dated note to the routine memory. Creates the file on first write. */
export function appendRoutineMemory(storagePath, routineId, note, { routineName = "" } = {}) {
  const text = String(note || "").trim();
  if (!text) throw new Error("nothing to remember (empty note)");
  ensureRoutineMemory(storagePath, routineId, routineName);
  const file = routineMemoryPath(storagePath, routineId);
  const today = new Date().toISOString().slice(0, 10);
  const heading = `## ${today}`;
  const oneLine = text.replace(/\n+/g, " ").trim();
  const bullet = `- ${oneLine}`;
  const existing = fs.readFileSync(file, "utf8");
  const next = existing.includes(heading)
    ? existing.trimEnd() + `\n${bullet}\n`
    : existing.trimEnd() + `\n\n${heading}\n${bullet}\n`;
  fs.writeFileSync(file, next);
  return { path: file, note: text };
}
