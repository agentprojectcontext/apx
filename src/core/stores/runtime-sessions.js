// On-disk session state for external runtimes (Claude Code, Codex, OpenCode,
// Aider, Cursor Agent, Gemini CLI, Qwen Code). One markdown file per session
// under <storageRoot>/agents/<slug>/sessions/<id>.md with YAML frontmatter
// (id, agent, title, task_ref, status, started, completed, result, runtime,
// external_session_path).
//
// The "bridge" prompt-text builder that explains this layout to the external
// runtime lives in core/agent/runtime-bridge.js. Both used to live together
// in host/daemon/apc-runtime-context.js; they were split because they have
// different homes (text → core/agent, state → core/stores).
import fs from "node:fs";
import path from "node:path";
import { generateSessionId } from "./sessions.js";
import { nowIso } from "#core/util/time.js";

/** Create the APX runtime session file. Returns { id, filename, path }. */
export function createRuntimeSession({
  projectRoot,
  storageRoot = projectRoot,
  agentSlug,
  runtime,
  taskRef = "",
  title,
  // WHERE it ran. Recorded because continuing a session has to reopen the same
  // repo, and because a session record that cannot say which folder it touched
  // is a record of nothing in particular — the 2026-09-20 sessions all said
  // "claude-code" and none of them said they had opened the wrong directory.
  cwd = "",
}) {
  const dir = path.join(storageRoot, "agents", agentSlug, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const id = generateSessionId(storageRoot, agentSlug);
  const file = path.join(dir, `${id}.md`);
  const started = nowIso();
  const sessionTitle = title || `Runtime: ${runtime}`;
  const body =
    `---\n` +
    `id: ${id}\n` +
    `agent: ${agentSlug}\n` +
    `title: ${sessionTitle}\n` +
    `task_ref: ${taskRef}\n` +
    `status: 🔄 In progress\n` +
    `started: ${started}\n` +
    `completed: \n` +
    `result: \n` +
    `runtime: ${runtime}\n` +
    `cwd: ${cwd || projectRoot || ""}\n` +
    `external_session_path: \n` +
    `---\n\n` +
    `# ${sessionTitle}\n\n`;
  fs.writeFileSync(file, body);
  return { id, filename: `${id}.md`, path: file };
}

/** Update session frontmatter with the external transcript path + final state. */
export function closeRuntimeSession({ filePath, externalSessionPath, exitCode, result }) {
  let text = fs.readFileSync(filePath, "utf8");
  text = setField(text, "completed", nowIso());
  if (externalSessionPath) {
    text = setField(text, "external_session_path", externalSessionPath);
  }
  if (typeof exitCode === "number") {
    text = setField(
      text,
      "result",
      `${exitCode === 0 ? "✅" : "⚠️"} exit ${exitCode}: ${(result || "").slice(0, 200)}`
    );
  } else if (result) {
    text = setField(text, "result", result.slice(0, 300));
  }
  text = setField(text, "status", exitCode === 0 ? "✅ Completed" : "⚠️ Closed with error");
  fs.writeFileSync(filePath, text);
}

/**
 * Every runtime session a project holds, newest first.
 *
 * These files were only ever WRITTEN — created at spawn, closed at exit — and
 * read back one at a time by id when a run was resumed. Nothing listed them, so
 * "what sessions have you been launching?" (Manu, 2026-09-20) had no answer
 * short of `ls` in a folder nobody documents.
 *
 * Frontmatter only: the body of these files is whatever the runtime wrote into
 * them, which can be long, and a LIST must not pay for it. The transcript the
 * external engine keeps is named by `external_session_path`; the detail reader
 * is what follows that pointer.
 *
 * @param {string} storageRoot  the project's storage path (~/.apx/projects/<id>)
 * @param {{limit?: number, agentSlug?: string}} [opts]
 */
export function listRuntimeSessions(storageRoot, opts = {}) {
  const agentsDir = path.join(storageRoot, "agents");
  let slugs = [];
  try {
    slugs = opts.agentSlug ? [opts.agentSlug] : fs.readdirSync(agentsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of slugs) {
    const dir = path.join(agentsDir, slug, "sessions");
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dir, file);
      let text = "";
      try {
        // The head is enough: frontmatter sits at the top and these files can
        // carry a whole session's notes underneath it.
        const fd = fs.openSync(full, "r");
        const buf = Buffer.alloc(4096);
        const n = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        text = buf.slice(0, n).toString("utf8");
      } catch {
        continue;
      }
      const meta = readFrontmatter(text);
      if (!meta) continue;
      out.push({
        ...meta,
        id: meta.id || file.replace(/\.md$/, ""),
        agent: meta.agent || slug,
        path: full,
        // Derived rather than stored: a file written by an older APX has no
        // `status` line, and a reader that branched on its absence would draw
        // every historical session as "unknown".
        done: !!meta.completed,
        failed: /⚠️|error|failed/i.test(String(meta.status || meta.result || "")),
        // STILL OPEN IS NOT STILL RUNNING.
        //
        // A record closes when the run ends, and nothing closes it when the run
        // does not end — the daemon was killed mid-flight, the machine slept,
        // the process died past the point that writes `completed`. The file
        // then says "🔄 In progress" for ever, and a list that trusted it
        // showed two sessions as running eleven and twenty-three days after
        // they stopped (Manu, 2026-09-20: "por qué estos dos se ven corriendo
        // si ya terminaron?").
        //
        // No registry can answer this across a restart, but arithmetic can: a
        // run cannot outlive its own deadline, and the longest one APX hands
        // out is the background hour. Past the window below the process is
        // gone whatever the file says.
        abandoned: isAbandonedSession(meta),
        mtime: safeStatMtime(full),
      });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}

/** One session by id, with the body the runtime left in it. */
export function readRuntimeSession(storageRoot, id, opts = {}) {
  const row = listRuntimeSessions(storageRoot, opts).find((s) => s.id === id);
  if (!row) return null;
  let text = "";
  try {
    text = fs.readFileSync(row.path, "utf8");
  } catch {
    return row;
  }
  const end = text.indexOf("\n---", 4);
  return { ...row, body: end === -1 ? "" : text.slice(end + 4).trim() };
}

/**
 * How long an open record stays believable.
 *
 * Six hours against a background deadline of one: generous enough that a run
 * given a raised `timeout_s` is never called dead while it is working, short
 * enough that yesterday's crash does not still read as live work. A run that
 * legitimately outlives this is mislabelled until it closes — which is the
 * cheaper of the two mistakes, because the other one hides a failure.
 */
export const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000;

/** `started` is an ISO stamp written at spawn; anything unparseable is treated
 *  as old, because a record with no start and no end is not a live run. */
function startedLongerAgoThan(started, ms) {
  const at = Date.parse(String(started || ""));
  if (!Number.isFinite(at)) return true;
  return Date.now() - at > ms;
}

/**
 * Is this record still open, and too old for anything to be running it?
 *
 * Exported so every surface answers it the same way. The CLI has its own
 * session reader and printed 🔄 off the stored `status` line, so `apx session
 * list` was still calling an eleven-day-old record "in progress" after the
 * panel had stopped — the same lie through a different door, and Manu's
 * standing rule is that the CLI and the web say the same thing.
 */
export function isAbandonedSession({ completed, started } = {}) {
  return !completed && startedLongerAgoThan(started, ABANDONED_AFTER_MS);
}

function safeStatMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** The `key: value` head of a session file, as a flat object. */
function readFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(4, end).split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * One frontmatter line, always.
 *
 * `result` is the runtime's own words, and a runtime that answers with a
 * markdown report puts newlines in them. Written raw, those newlines END the
 * frontmatter: everything after the first one — `runtime`, `external_session_path`
 * — falls out of the head and into the body, so a reader gets a session whose
 * engine is `undefined`. Seen on 2026-09-20-05, whose result opened with a
 * heading.
 */
function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function setField(text, field, value) {
  value = oneLine(value);
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const fmText = text.slice(4, end);
  const lines = fmText.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${field}:`)) {
      found = true;
      return `${field}: ${value}`;
    }
    return line;
  });
  if (!found) out.push(`${field}: ${value}`);
  return `---\n${out.join("\n")}\n---${text.slice(end + 4)}`;
}

/**
 * Extract a self-reported "APC_RESULT: ..." line from the runtime's stdout
 * (the convention printed in the bridge hint). Returns the captured string
 * or null. Fallback for runtimes that can't shell out to `apx session close`.
 */
export function extractRuntimeResult(stdout) {
  if (!stdout || typeof stdout !== "string") return null;
  const m = stdout.match(/^APC_RESULT:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

// Back-compat alias.
export const extractApfResult = extractRuntimeResult;
