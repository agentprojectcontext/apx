// Cross-engine session discovery.
//
// Every AI coding engine keeps its transcripts somewhere different and in a
// different shape: Claude Code writes JSONL under a folder named after the
// encoded project path, Codex writes dated rollout files, APX keeps markdown
// with frontmatter, Antigravity has its own tree. This module hides that: each
// engine is a small adapter, and callers ask for "sessions for this directory"
// without knowing whose format it is.
//
// It used to live in src/interfaces/cli/commands/sessions.js — 1008 lines of
// domain engine inside a *surface*. Because that was its only home, both
// core/agent/tools/handlers/search-sessions.js and host/daemon/api/sessions.js
// had to import upward into the CLI, inverting the layering. Two narrower
// re-implementations had also grown in core/stores/ to avoid the dependency.
// One home now: the CLI, the daemon and the agent tool all call this.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apcProjectFile } from "#core/apc/paths.js";
import { parseFrontmatterFields as parseFrontmatter } from "#core/apc/frontmatter.js";

// ── shared helpers ───────────────────────────────────────────────────────────

const homeDir = (opts) => (opts && opts.home) || os.homedir();

// Claude Code encodes a project cwd into a folder name by replacing every
// non-alphanumeric character with "-". Mirrors encodeClaudeProjectPath in the
// claude-code runtime adapter.
function encodeClaudeProjectPath(cwd) {
  return String(cwd || "").replace(/[^A-Za-z0-9]/g, "-");
}

function safeStatMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// File-modification timestamps get clobbered by Time Machine and other backup
// tools. Most engines write a `"timestamp": "<iso>"` field on every JSONL line
// — when present, that's a far more reliable order key than mtime. We read a
// short tail of the file and scan back for the latest valid timestamp,
// falling back to the head, then mtime, when nothing parses.
function readInternalTimestamp(file, { tailBytes = 8192, headBytes = 8192 } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return 0;
  }
  const tail = readTimestampFromRange(file, Math.max(0, stat.size - tailBytes), stat.size, { fromEnd: true });
  if (tail) return tail;
  if (stat.size > tailBytes) {
    const head = readTimestampFromRange(file, 0, Math.min(stat.size, headBytes), { fromEnd: false });
    if (head) return head;
  }
  return stat.mtimeMs || 0;
}

function readTimestampFromRange(file, start, end, { fromEnd }) {
  if (end <= start) return 0;
  let buf;
  try {
    const fd = fs.openSync(file, "r");
    try {
      buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  } catch {
    return 0;
  }
  const lines = buf.toString("utf8").split("\n");
  const order = fromEnd ? [...lines.keys()].reverse() : [...lines.keys()];
  for (const i of order) {
    const line = lines[i];
    if (!line || !line.includes('"timestamp"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = d?.timestamp || d?.payload?.timestamp;
    if (!ts) continue;
    const t = Date.parse(ts);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function sessionTimestamp(file) {
  return readInternalTimestamp(file) || safeStatMtime(file);
}

export function fmtDate(ms) {
  if (!ms) return "          ";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Read the first bytes of a file (used for one-line JSONL headers).
function readHead(file, bytes = 8192) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

// Registered APX projects come from ~/.apx/config.json — APX does not know
// every project on disk, so an unregistered project must be passed via --dir.
function readApxProjects(opts) {
  const cfgPath = path.join(homeDir(opts), ".apx", "config.json");
  let entries = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    entries = Array.isArray(cfg.projects) ? cfg.projects : [];
  } catch {}
  return entries
    .filter((e) => e && e.path)
    .map((e) => {
      const proj = { path: path.resolve(e.path), name: null, apxId: null };
      try {
        const pj = JSON.parse(
          fs.readFileSync(apcProjectFile(proj.path), "utf8")
        );
        if (pj.name) proj.name = pj.name;
        if (pj.apx_id) proj.apxId = pj.apx_id;
      } catch {}
      if (!proj.name) proj.name = path.basename(proj.path);
      return proj;
    });
}

// Resolve the working directory the user wants sessions for.
//   --dir <path>      → explicit path
//   --project <name>  → look up a registered APX project
//   neither           → null (caller enters discovery mode)
export function resolveTargetDir(args, opts) {
  const dirFlag = args.flags.dir;
  if (dirFlag && dirFlag !== true) return path.resolve(String(dirFlag));

  const projFlag = args.flags.project;
  if (projFlag && projFlag !== true) {
    const q = String(projFlag).toLowerCase();
    const projects = readApxProjects(opts);
    const exact =
      projects.find((p) => p.name.toLowerCase() === q) ||
      projects.find((p) => path.basename(p.path).toLowerCase() === q);
    if (exact) return exact.path;

    const fuzzy = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
    if (fuzzy.length === 1) return fuzzy[0].path;
    if (fuzzy.length > 1) {
      throw new Error(
        `--project "${projFlag}" is ambiguous; matches: ${fuzzy
          .map((p) => p.name)
          .join(", ")}`
      );
    }
    const known = projects.length
      ? projects.map((p) => p.name).join(", ")
      : "(none registered)";
    throw new Error(
      `--project "${projFlag}" not found in registered APX projects (${known}). ` +
        `Use --dir <path> for an unregistered project.`
    );
  }
  return null;
}

// ── claude code engine ───────────────────────────────────────────────────────

function claudeProjectsDir(opts) {
  return path.join(homeDir(opts), ".claude", "projects");
}

function claudeReadTitle(file) {
  let title = null;
  let lastPrompt = null;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (!line.includes('"aiTitle"') && !line.includes('"lastPrompt"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type === "ai-title" && d.aiTitle) title = d.aiTitle;
    else if (d.type === "last-prompt" && d.lastPrompt) lastPrompt = d.lastPrompt;
  }
  return title || lastPrompt || null;
}

// Decode a Claude project folder name back to a cwd-like path. The encoding is
// lossy (every non-alphanumeric becomes "-"), so this returns the encoded name
// when no registered APX project maps back to a real cwd.
function claudeDecodeProject(encoded, opts) {
  const known = readApxProjects(opts);
  const hit = known.find((p) => encodeClaudeProjectPath(p.path) === encoded);
  return hit ? hit.path : null;
}

const claudeEngine = {
  id: "claude",
  label: "Claude Code",
  implemented: true,
  detect(opts) {
    const dir = claudeProjectsDir(opts);
    return fs.existsSync(dir)
      ? { available: true }
      : { available: false, reason: `${dir} not found` };
  },
  // Locate <id>.jsonl across every Claude project folder. Used by
  // `apx session resume <id>` so the user doesn't need to know the cwd.
  findSessionById(id, opts) {
    const root = claudeProjectsDir(opts);
    if (!fs.existsSync(root)) return null;
    for (const name of fs.readdirSync(root)) {
      const file = path.join(root, name, `${id}.jsonl`);
      if (fs.existsSync(file)) {
        return {
          engine: "claude",
          id,
          path: file,
          cwd: claudeDecodeProject(name, opts) || name,
          mtime: sessionTimestamp(file),
          title: claudeReadTitle(file) || "(sin título)",
        };
      }
    }
    return null;
  },
  // Read the full JSONL transcript. Returns raw text plus a tail trimmed to
  // tailBytes (default 64 KB) so callers can show "last N bytes" without
  // loading huge logs into memory.
  readSession(meta, { tailBytes = 64 * 1024 } = {}) {
    if (!meta?.path || !fs.existsSync(meta.path)) {
      return { found: false };
    }
    const raw = fs.readFileSync(meta.path, "utf8");
    return {
      found: true,
      raw,
      tail: raw.length > tailBytes ? raw.slice(-tailBytes) : raw,
      size: raw.length,
      format: "jsonl",
    };
  },
  listProjects(opts) {
    const root = claudeProjectsDir(opts);
    const known = new Map(
      readApxProjects(opts).map((p) => [encodeClaudeProjectPath(p.path), p])
    );
    const out = [];
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      let files;
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      if (files.length === 0) continue;
      const matched = known.get(name);
      out.push({
        key: matched ? matched.name : name,
        dir: matched ? matched.path : null,
        label: matched ? matched.path : name,
        count: files.length,
        mtime: Math.max(...files.map((f) => sessionTimestamp(path.join(dir, f)))),
      });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  },
  listSessions(dir, opts) {
    const folder = path.join(
      claudeProjectsDir(opts),
      encodeClaudeProjectPath(dir)
    );
    if (!fs.existsSync(folder)) return { found: false, location: folder };
    const sessions = [];
    for (const f of fs.readdirSync(folder)) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(folder, f);
      sessions.push({
        id: f.slice(0, -6),
        mtime: sessionTimestamp(file),
        title: claudeReadTitle(file) || "(sin título)",
        path: file,
      });
    }
    sessions.sort((a, b) => b.mtime - a.mtime);
    return { found: true, location: folder, sessions };
  },
  continueHint() {
    return `claude --continue   (run from the project directory)`;
  },
  resumeHint(id) {
    return `claude -p --resume ${id} "your prompt"`;
  },
};

// ── codex engine ─────────────────────────────────────────────────────────────

function codexSessionsDir(opts) {
  return path.join(homeDir(opts), ".codex", "sessions");
}

// Codex stores titles in ~/.codex/session_index.jsonl keyed by session id.
function codexTitleIndex(opts) {
  const file = path.join(homeDir(opts), ".codex", "session_index.jsonl");
  const map = new Map();
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.id && d.thread_name) map.set(d.id, d.thread_name);
    } catch {}
  }
  return map;
}

// Walk ~/.codex/sessions/YYYY/MM/DD/ collecting rollout-*.jsonl files and
// reading their session_meta header (first line) for id + cwd. Prefers the
// internal timestamp over mtime so backups don't scramble the order.
function codexScanRollouts(opts) {
  const root = codexSessionsDir(opts);
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        const head = readHead(full);
        const id = (head.match(/"id":"([^"]+)"/) || [])[1];
        const cwd = (head.match(/"cwd":"([^"]+)"/) || [])[1];
        if (id) found.push({ id, cwd: cwd || null, mtime: sessionTimestamp(full) });
      }
    }
  };
  walk(root);
  return found;
}

// Scan rollouts but also keep the absolute path so resume-by-id can read the
// file straight off disk. Old codexScanRollouts dropped the path; this helper
// keeps it.
function codexScanRolloutsWithPath(opts) {
  const root = codexSessionsDir(opts);
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        const head = readHead(full);
        const id = (head.match(/"id":"([^"]+)"/) || [])[1];
        const cwd = (head.match(/"cwd":"([^"]+)"/) || [])[1];
        if (id)
          found.push({
            id,
            cwd: cwd || null,
            mtime: sessionTimestamp(full),
            path: full,
          });
      }
    }
  };
  walk(root);
  return found;
}

const codexEngine = {
  id: "codex",
  label: "Codex",
  implemented: true,
  detect(opts) {
    const dir = codexSessionsDir(opts);
    return fs.existsSync(dir)
      ? { available: true }
      : { available: false, reason: `${dir} not found` };
  },
  findSessionById(id, opts) {
    const hit = codexScanRolloutsWithPath(opts).find((r) => r.id === id);
    if (!hit) return null;
    const titles = codexTitleIndex(opts);
    return {
      engine: "codex",
      id,
      path: hit.path,
      cwd: hit.cwd,
      mtime: hit.mtime,
      title: titles.get(id) || "(sin título)",
    };
  },
  readSession(meta, { tailBytes = 64 * 1024 } = {}) {
    if (!meta?.path || !fs.existsSync(meta.path)) {
      return { found: false };
    }
    const raw = fs.readFileSync(meta.path, "utf8");
    return {
      found: true,
      raw,
      tail: raw.length > tailBytes ? raw.slice(-tailBytes) : raw,
      size: raw.length,
      format: "jsonl",
    };
  },
  listProjects(opts) {
    const byCwd = new Map();
    for (const r of codexScanRollouts(opts)) {
      if (!r.cwd) continue;
      const cur = byCwd.get(r.cwd) || { count: 0, mtime: 0 };
      cur.count++;
      if (r.mtime > cur.mtime) cur.mtime = r.mtime;
      byCwd.set(r.cwd, cur);
    }
    return [...byCwd.entries()]
      .map(([cwd, v]) => ({
        key: cwd,
        dir: cwd,
        label: cwd,
        count: v.count,
        mtime: v.mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  },
  listSessions(dir, opts) {
    const titles = codexTitleIndex(opts);
    const sessions = codexScanRolloutsWithPath(opts)
      .filter((r) => r.cwd === dir)
      .map((r) => ({
        id: r.id,
        mtime: r.mtime,
        title: titles.get(r.id) || "(sin título)",
        path: r.path,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return { found: sessions.length > 0, location: dir, sessions };
  },
  continueHint() {
    return `codex resume --last`;
  },
  resumeHint(id) {
    return `codex exec resume ${id} "your prompt"   (interactive: codex resume ${id})`;
  },
};

// ── apx engine (default) ─────────────────────────────────────────────────────


// APX sessions are .md with ISO timestamps in frontmatter — prefer those over
// mtime for the same backup-safety reason the JSONL engines do.
function apxSessionTimestamp(fm, file) {
  for (const field of ["completed", "started"]) {
    const v = fm?.[field];
    if (!v || typeof v !== "string") continue;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return safeStatMtime(file);
}

function apxStorageRoot(opts) {
  return path.join(homeDir(opts), ".apx", "projects");
}

const apxEngine = {
  id: "apx",
  label: "APX",
  implemented: true,
  detect() {
    return { available: true };
  },
  // Walk every registered APX project looking for a session file whose
  // frontmatter `id:` or filename (without .md) equals the given id.
  findSessionById(id, opts) {
    const projects = readApxProjects(opts);
    for (const proj of projects) {
      if (!proj.apxId) continue;
      const agentsDir = path.join(apxStorageRoot(opts), proj.apxId, "agents");
      if (!fs.existsSync(agentsDir)) continue;
      for (const slug of fs.readdirSync(agentsDir)) {
        const sdir = path.join(agentsDir, slug, "sessions");
        let files;
        try {
          files = fs.readdirSync(sdir);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith(".md")) continue;
          const file = path.join(sdir, f);
          const baseId = f.slice(0, -3);
          const fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
          if (fm.id === id || baseId === id) {
            return {
              engine: "apx",
              id: fm.id || baseId,
              path: file,
              cwd: proj.path,
              mtime: apxSessionTimestamp(fm, file),
              title: fm.title || baseId,
              agentSlug: slug,
              apxId: proj.apxId,
              projectName: proj.name,
              externalSessionPath: fm.external_session_path || null,
            };
          }
        }
      }
    }
    return null;
  },
  // Read the APX session markdown. If the frontmatter points to an external
  // transcript (the JSONL the underlying engine left behind), include its tail
  // too — same data shape callers see for claude/codex direct reads.
  readSession(meta, { tailBytes = 64 * 1024 } = {}) {
    if (!meta?.path || !fs.existsSync(meta.path)) {
      return { found: false };
    }
    const raw = fs.readFileSync(meta.path, "utf8");
    const result = {
      found: true,
      raw,
      tail: raw,
      size: raw.length,
      format: "markdown",
    };
    if (meta.externalSessionPath && fs.existsSync(meta.externalSessionPath)) {
      const ext = fs.readFileSync(meta.externalSessionPath, "utf8");
      result.external = {
        path: meta.externalSessionPath,
        raw: ext,
        tail: ext.length > tailBytes ? ext.slice(-tailBytes) : ext,
        size: ext.length,
        format: "jsonl",
      };
    }
    return result;
  },
  listProjects(opts) {
    return readApxProjects(opts).map((p) => {
      let count = 0;
      let mtime = 0;
      if (p.apxId) {
        const agentsDir = path.join(apxStorageRoot(opts), p.apxId, "agents");
        try {
          for (const slug of fs.readdirSync(agentsDir)) {
            const sdir = path.join(agentsDir, slug, "sessions");
            try {
              for (const f of fs.readdirSync(sdir)) {
                if (!f.endsWith(".md")) continue;
                count++;
                const file = path.join(sdir, f);
                const fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
                mtime = Math.max(mtime, apxSessionTimestamp(fm, file));
              }
            } catch {}
          }
        } catch {}
      }
      return { key: p.name, dir: p.path, label: p.path, count, mtime };
    });
  },
  listSessions(dir, opts) {
    let apxId = null;
    try {
      const pj = JSON.parse(
        fs.readFileSync(apcProjectFile(dir), "utf8")
      );
      apxId = pj.apx_id || null;
    } catch {}
    if (!apxId) return { found: false, location: dir };
    const agentsDir = path.join(apxStorageRoot(opts), apxId, "agents");
    if (!fs.existsSync(agentsDir)) return { found: false, location: agentsDir };
    const sessions = [];
    for (const slug of fs.readdirSync(agentsDir)) {
      const sdir = path.join(agentsDir, slug, "sessions");
      let files;
      try {
        files = fs.readdirSync(sdir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".md")) continue;
        const file = path.join(sdir, f);
        const fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
        sessions.push({
          id: fm.id || f.slice(0, -3),
          mtime: apxSessionTimestamp(fm, file),
          title: `[${slug}] ${fm.title || "(sin título)"}`,
          path: file,
        });
      }
    }
    sessions.sort((a, b) => b.mtime - a.mtime);
    return { found: sessions.length > 0, location: agentsDir, sessions };
  },
  continueHint() {
    return `apx session list   (run from the project directory)`;
  },
  resumeHint(id) {
    return `apx session resume ${id}`;
  },
};

// ── antigravity engine (detected, listing not implemented) ───────────────────

const antigravityEngine = {
  id: "antigravity",
  label: "Antigravity",
  implemented: false,
  detect(opts) {
    const candidates = [
      path.join(homeDir(opts), ".antigravity"),
      path.join(
        homeDir(opts),
        "Library",
        "Application Support",
        "Antigravity"
      ),
    ];
    const hit = candidates.find((c) => fs.existsSync(c));
    return hit
      ? { available: true }
      : { available: false, reason: "Antigravity not installed" };
  },
};

export const ENGINES = {
  apx: apxEngine,
  claude: claudeEngine,
  codex: codexEngine,
  antigravity: antigravityEngine,
};

// ── cross-engine helpers (used by `apx session resume <id>` etc.) ────────────

/**
 * Search every implemented + detected engine for a session whose id matches.
 * Returns an array of hits (0, 1, or more if the same id exists in multiple
 * engines — callers should disambiguate via --engine).
 */
export function findSessionAcrossEngines(id, opts = {}) {
  const hits = [];
  for (const engine of Object.values(ENGINES)) {
    if (!engine.implemented || typeof engine.findSessionById !== "function") continue;
    const detected = engine.detect(opts);
    if (!detected.available) continue;
    try {
      const hit = engine.findSessionById(id, opts);
      if (hit) hits.push(hit);
    } catch {}
  }
  return hits;
}

/** Same as findSessionAcrossEngines but limited to one engine id. */
export function findSessionInEngine(engineId, id, opts = {}) {
  const engine = ENGINES[engineId];
  if (!engine) return null;
  if (!engine.implemented || typeof engine.findSessionById !== "function") return null;
  const detected = engine.detect(opts);
  if (!detected.available) return null;
  return engine.findSessionById(id, opts);
}

/**
 * Enumerate every session across every detected+implemented engine, returning
 * flat rows of { engine, id, title, mtime, cwd, path }. Used by `apx session
 * find`. When `dir` is given, only that working directory is scanned (cheap);
 * otherwise every project the engine knows about is walked.
 *
 * Caveat: an engine can only enumerate a project when it can resolve its cwd.
 * Codex always records cwd; APX uses registered projects; Claude can only list
 * folders that map back to a registered APX project (its folder names are a
 * lossy encoding of the original path). Scope with --dir to reach the rest.
 */
export function collectAllSessions(opts = {}, { dir = null, engineId = null } = {}) {
  const out = [];
  for (const engine of Object.values(ENGINES)) {
    if (engineId && engine.id !== engineId) continue;
    if (!engine.implemented || typeof engine.listSessions !== "function") continue;
    if (!engine.detect(opts).available) continue;

    const dirs = [];
    if (dir) {
      dirs.push(dir);
    } else {
      let projects = [];
      try {
        projects = engine.listProjects(opts) || [];
      } catch {}
      for (const p of projects) if (p.dir) dirs.push(p.dir);
    }

    for (const d of dirs) {
      let res;
      try {
        res = engine.listSessions(d, opts);
      } catch {
        continue;
      }
      if (!res || !res.found) continue;
      for (const s of res.sessions || []) {
        out.push({
          engine: engine.id,
          id: s.id,
          title: s.title || "",
          mtime: s.mtime || 0,
          cwd: d,
          path: s.path || null,
        });
      }
    }
  }
  return out;
}

// Read a session file off disk for content (deep) search. Cheap: we already
// have the absolute path from collectAllSessions, so no per-candidate rescan.
function sessionContainsText(row, needle) {
  if (!row.path) return false;
  let text;
  try {
    text = fs.readFileSync(row.path, "utf8");
  } catch {
    return false;
  }
  return text.toLowerCase().includes(needle);
}

// Filter collected session rows by a free-text query. Always matches the
// title; with deep=true also scans transcript content (slower). De-dupes by
// engine:id and returns full rows + a `match` field ("title"|"content"),
// newest first. Shared core for the CLI (apx session find) and the daemon
// (GET /sessions?q=…) so terminal and web search behave identically.
export function filterSessionsByQuery(rows, { query, deep = false, limit = 0 } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const seen = new Set();
  const matches = [];
  for (const row of rows) {
    const titleHit = String(row.title).toLowerCase().includes(needle);
    let where = titleHit ? "title" : null;
    if (!titleHit && deep && sessionContainsText(row, needle)) where = "content";
    if (!where) continue;
    const key = `${row.engine}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ ...row, match: where });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return limit > 0 ? matches.slice(0, limit) : matches;
}
