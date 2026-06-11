// Code sessions — persistent, structured transcripts for the web Code module
// (the OpenCode-style coding surface). Unlike the human-readable per-agent
// markdown sessions (api/sessions.js), these hold the RICH turn shape the UI
// needs: interleaved text + tool parts, per-turn usage/model/mode, and a git
// baseline for the changes/diff view. One JSON file per session:
//
//   ~/.apx/projects/<apxId>/code-sessions/<id>.json
//
// The `parts` shape mirrors the front-end ChatPart union (hooks/useChat.ts) so
// stored turns render with the existing MessageBubble/ToolCall with zero
// translation.
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "../util/time.js";
import { shortId as makeShortId } from "../util/ids.js";

function sessionsDir(storagePath) {
  return path.join(storagePath, "code-sessions");
}

function sessionFile(storagePath, id) {
  return path.join(sessionsDir(storagePath), `${id}.json`);
}

function shortId() {
  return makeShortId("cs");
}

// Atomic write: tmp file + rename so a crash mid-write can't corrupt a session.
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Lightweight row for the session list (no messages). */
function toRow(s) {
  return {
    id: s.id,
    title: s.title,
    mode: s.mode,
    model: s.model || null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    hasGit: !!(s.git && s.git.baselineTree),
  };
}

/** List sessions for a project, newest-updated first. */
export function listCodeSessions(storagePath) {
  const dir = sessionsDir(storagePath);
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const s = readJson(path.join(dir, f));
    if (s && s.id) rows.push(toRow(s));
  }
  rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return rows;
}

/** Full session (with messages) or null. */
export function getCodeSession(storagePath, id) {
  if (!id || typeof id !== "string") return null;
  return readJson(sessionFile(storagePath, id));
}

/**
 * Create a new session.
 * fields: { projectId, title?, model?, mode?, git? }
 */
export function createCodeSession(storagePath, fields = {}) {
  const id = shortId();
  const ts = nowIso();
  const session = {
    id,
    projectId: fields.projectId != null ? String(fields.projectId) : null,
    title: (fields.title && String(fields.title).trim()) || "New session",
    createdAt: ts,
    updatedAt: ts,
    model: fields.model || null,
    mode: fields.mode === "plan" ? "plan" : "build",
    git: fields.git && typeof fields.git === "object" ? fields.git : null,
    messages: [],
  };
  writeJson(sessionFile(storagePath, id), session);
  return session;
}

/**
 * Shallow-merge a patch into a session. Whitelisted keys only; `messages`,
 * `id`, `createdAt`, `projectId` are never overwritten here.
 */
export function updateCodeSession(storagePath, id, patch = {}) {
  const session = getCodeSession(storagePath, id);
  if (!session) return null;
  if (patch.title != null) session.title = String(patch.title).trim() || session.title;
  if (patch.model !== undefined) session.model = patch.model || null;
  if (patch.mode === "plan" || patch.mode === "build") session.mode = patch.mode;
  if (patch.git !== undefined) session.git = patch.git;
  session.updatedAt = nowIso();
  writeJson(sessionFile(storagePath, id), session);
  return session;
}

/** Delete a session file. Returns true if it existed. */
export function removeCodeSession(storagePath, id) {
  const file = sessionFile(storagePath, id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/**
 * Append a turn (user or assistant) to a session and bump updatedAt.
 * turn: { role, parts, model?, mode?, usage?, ts? }
 * Returns the updated session, or null if the session is gone.
 */
export function appendTurn(storagePath, id, turn) {
  const session = getCodeSession(storagePath, id);
  if (!session) return null;
  const entry = {
    role: turn.role === "user" ? "user" : "assistant",
    parts: Array.isArray(turn.parts) ? turn.parts : [],
    ts: turn.ts || nowIso(),
  };
  if (turn.model) entry.model = turn.model;
  if (turn.mode) entry.mode = turn.mode;
  if (turn.usage) entry.usage = turn.usage;
  if (turn.notes && turn.notes.length) entry.notes = turn.notes;
  session.messages.push(entry);
  session.updatedAt = entry.ts;
  writeJson(sessionFile(storagePath, id), session);
  return session;
}
