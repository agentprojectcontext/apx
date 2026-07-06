// Durable pending-callback store for background runtime runs.
//
// When call_runtime launches a runtime detached (background mode), the result
// must reach the originating chat when the runtime finishes — even if the
// daemon that spawned it dies in the meantime (a crash, a pull, or, as we hit
// in testing, a task whose very job is to restart the daemon). An in-memory
// promise can't survive that. So we drop a small durable "IOU" here at launch;
// a reconciler (host/daemon/callback-reconciler.js) delivers it once the
// runtime's session record shows the run finished — regardless of WHICH daemon
// is alive, and regardless of who closed the session (the daemon's own await,
// or the runtime proactively via `apx session close`).
//
// One JSON file per pending callback: <APX_HOME>/pending-callbacks/<id>.json.
// The in-process fast path deletes the file the moment it takes ownership of
// delivery; whatever files remain are runs whose spawning daemon never got to
// deliver — exactly the set the reconciler must handle.
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "#core/config/paths.js";
import { nowIso } from "#core/util/time.js";

export const PENDING_CALLBACKS_DIR = path.join(APX_HOME, "pending-callbacks");

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function fileFor(sessionId) {
  return path.join(PENDING_CALLBACKS_DIR, `${sessionId}.json`);
}

/**
 * Record that a background runtime run owes a callback to a channel. `entry`:
 * { session_id, session_path, channel, chat_id, tg_channel, runtime, agent, who }.
 * Best-effort — a failure to persist must never break the launch.
 */
export function writePendingCallback(entry) {
  try {
    if (!entry?.session_id || !SAFE_ID.test(String(entry.session_id))) return;
    fs.mkdirSync(PENDING_CALLBACKS_DIR, { recursive: true });
    fs.writeFileSync(fileFor(entry.session_id), JSON.stringify({ ...entry, created: nowIso() }, null, 2));
  } catch {
    /* best-effort */
  }
}

/** Drop the IOU — called the instant an in-process delivery takes ownership. */
export function deletePendingCallback(sessionId) {
  try {
    if (!sessionId || !SAFE_ID.test(String(sessionId))) return;
    fs.rmSync(fileFor(sessionId), { force: true });
  } catch {
    /* best-effort */
  }
}

/** All outstanding IOUs (parsed). Silently skips unreadable/corrupt files. */
export function listPendingCallbacks() {
  let files;
  try {
    files = fs.readdirSync(PENDING_CALLBACKS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(PENDING_CALLBACKS_DIR, f), "utf8"));
      if (entry?.session_id) out.push(entry);
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

/**
 * Read the finished-state of a runtime session .md by parsing its frontmatter.
 * Returns { exists, done, status, result, completed } — `done` is true once the
 * run has a completed timestamp (set by the daemon's closeRuntimeSession OR by
 * the runtime's proactive `apx session close`).
 */
export function readSessionState(sessionPath) {
  let text;
  try {
    text = fs.readFileSync(sessionPath, "utf8");
  } catch {
    return { exists: false, done: false };
  }
  const fm = {};
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      for (const line of text.slice(4, end).split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    }
  }
  const completed = fm.completed || "";
  const status = fm.status || "";
  return {
    exists: true,
    done: !!completed && !/in progress/i.test(status),
    status,
    result: fm.result || "",
    completed,
  };
}
