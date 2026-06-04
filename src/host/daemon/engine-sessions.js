// Read-only helpers for locating + summarising sessions stored by external
// engines (Claude Code, Codex) and APX itself. Lives in the daemon so super-
// agent tools (call_runtime, etc.) can pull "what was that prior session
// about?" context without depending on the CLI module tree.
//
// Mirrors a subset of src/interfaces/cli/commands/sessions.js — kept narrow on
// purpose: only enough to (a) find a session by id across engines and (b) read
// title + last-prompt so the runtime gets context when resuming.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const homeDir = (opts) => (opts && opts.home) || os.homedir();

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

// Walk every project folder under ~/.claude/projects looking for <id>.jsonl.
export function findClaudeSessionById(id, opts = {}) {
  const root = path.join(homeDir(opts), ".claude", "projects");
  if (!fs.existsSync(root)) return null;
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const name of entries) {
    const file = path.join(root, name, `${id}.jsonl`);
    if (fs.existsSync(file)) {
      return {
        engine: "claude",
        id,
        path: file,
        cwd: name,
        mtime: safeStatMtime(file),
      };
    }
  }
  return null;
}

// Walk ~/.codex/sessions/YYYY/MM/DD/ looking for a rollout file whose header
// claims the given id.
export function findCodexSessionById(id, opts = {}) {
  const root = path.join(homeDir(opts), ".codex", "sessions");
  if (!fs.existsSync(root)) return null;
  let hit = null;
  const walk = (dir) => {
    if (hit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.startsWith("rollout-") || !e.name.endsWith(".jsonl")) continue;
      let head;
      try {
        const fd = fs.openSync(full, "r");
        const buf = Buffer.alloc(8192);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        head = buf.subarray(0, n).toString("utf8");
      } catch {
        continue;
      }
      const m = head.match(/"id":"([^"]+)"/);
      if (m && m[1] === id) {
        hit = {
          engine: "codex",
          id,
          path: full,
          cwd: (head.match(/"cwd":"([^"]+)"/) || [])[1] || null,
          mtime: safeStatMtime(full),
        };
        return;
      }
    }
  };
  walk(root);
  return hit;
}

// Locate an APX-native session inside ~/.apx/projects/*/agents/*/sessions/.
export function findApxSessionById(id, opts = {}) {
  const projectsRoot = path.join(homeDir(opts), ".apx", "projects");
  if (!fs.existsSync(projectsRoot)) return null;
  let projectIds;
  try {
    projectIds = fs.readdirSync(projectsRoot);
  } catch {
    return null;
  }
  for (const projectId of projectIds) {
    const agentsDir = path.join(projectsRoot, projectId, "agents");
    if (!fs.existsSync(agentsDir)) continue;
    let slugs;
    try {
      slugs = fs.readdirSync(agentsDir);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const sdir = path.join(agentsDir, slug, "sessions");
      let files;
      try {
        files = fs.readdirSync(sdir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".md")) continue;
        const baseId = f.slice(0, -3);
        const file = path.join(sdir, f);
        if (baseId === id) {
          return {
            engine: "apx",
            id,
            path: file,
            mtime: safeStatMtime(file),
            agentSlug: slug,
            apxId: projectId,
          };
        }
      }
    }
  }
  return null;
}

// Try every implemented engine in order; first hit wins. Returns null if no
// engine knows the id. Callers that need collision detection should call the
// per-engine helpers directly.
export function findEngineSessionById(id, opts = {}) {
  return (
    findClaudeSessionById(id, opts) ||
    findCodexSessionById(id, opts) ||
    findApxSessionById(id, opts)
  );
}

// Pull a short summary of an external session: title (aiTitle / thread_name /
// frontmatter title) + last user prompt where we can find it. Used to seed a
// runtime "resume" call with context.
export function readEngineSessionContext(meta) {
  if (!meta || !meta.engine || !meta.path) return null;
  if (meta.engine === "claude") return readClaudeContext(meta.path);
  if (meta.engine === "codex") return readCodexContext(meta.path);
  if (meta.engine === "apx") return readApxContext(meta.path);
  return null;
}

function readClaudeContext(file) {
  let title = null;
  let lastPrompt = null;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
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
  return { title, lastPrompt };
}

function readCodexContext(file) {
  let title = null;
  let lastPrompt = null;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!title) {
      title = d?.payload?.thread_name || d?.thread_name || null;
    }
    const role = d?.payload?.role || d?.role;
    const content = d?.payload?.content || d?.content;
    if (role === "user" && typeof content === "string" && content.trim()) {
      lastPrompt = content.trim();
    }
  }
  return { title, lastPrompt };
}

function readApxContext(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let title = null;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      for (const line of text.slice(4, end).split("\n")) {
        const m = line.match(/^title:\s*(.*)$/);
        if (m) {
          title = m[1].trim();
          break;
        }
      }
    }
  }
  return { title, lastPrompt: null };
}
