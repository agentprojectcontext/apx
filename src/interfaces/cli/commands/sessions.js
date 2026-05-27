// apx sessions — list AI engine sessions (Claude Code, Codex, APX, ...) without
// opening an interactive picker. Each engine is a small adapter; the command
// resolves a working directory (from a registered APX project or an explicit
// --dir) and asks the adapter to list that engine's sessions for it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function fmtDate(ms) {
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
          fs.readFileSync(path.join(proj.path, ".apc", "project.json"), "utf8")
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
function resolveTargetDir(args, opts) {
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
        mtime: Math.max(...files.map((f) => safeStatMtime(path.join(dir, f)))),
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
        mtime: safeStatMtime(file),
        title: claudeReadTitle(file) || "(sin título)",
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
// reading their session_meta header (first line) for id + cwd.
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
        if (id) found.push({ id, cwd: cwd || null, mtime: safeStatMtime(full) });
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
    const sessions = codexScanRollouts(opts)
      .filter((r) => r.cwd === dir)
      .map((r) => ({
        id: r.id,
        mtime: r.mtime,
        title: titles.get(r.id) || "(sin título)",
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

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const fm = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
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
                mtime = Math.max(mtime, safeStatMtime(path.join(sdir, f)));
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
        fs.readFileSync(path.join(dir, ".apc", "project.json"), "utf8")
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
          mtime: safeStatMtime(file),
          title: `[${slug}] ${fm.title || "(sin título)"}`,
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

// ── command ──────────────────────────────────────────────────────────────────

function printSessions(engine, dir, result, limit) {
  if (!result.found) {
    console.log(`(no ${engine.label} sessions for ${dir})`);
    if (result.location) console.log(`  looked in: ${result.location}`);
    return;
  }
  let sessions = result.sessions;
  if (limit && limit > 0) sessions = sessions.slice(0, limit);

  console.log(`${engine.label} sessions for ${dir}`);
  console.log(`  ${result.location}`);
  console.log("");
  console.log(`${"DATE".padEnd(12)} ${"SESSION ID".padEnd(38)} TITLE`);
  console.log(`${"─".repeat(12)} ${"─".repeat(38)} ${"─".repeat(40)}`);
  for (const s of sessions) {
    console.log(
      `${fmtDate(s.mtime).padEnd(12)} ${String(s.id).padEnd(38)} ${String(
        s.title
      ).slice(0, 70)}`
    );
  }
  console.log("");
  console.log("Resume:");
  if (engine.continueHint) console.log(`  latest:   ${engine.continueHint(dir)}`);
  if (engine.resumeHint && sessions[0]) {
    console.log(`  specific: ${engine.resumeHint(sessions[0].id)}`);
  }
}

function printProjects(engine, projects) {
  if (projects.length === 0) {
    console.log(`(no ${engine.label} projects found)`);
    return;
  }
  console.log(`${engine.label} projects:`);
  console.log("");
  console.log(`${"SESSIONS".padEnd(9)} ${"LAST".padEnd(12)} PROJECT`);
  console.log(`${"─".repeat(9)} ${"─".repeat(12)} ${"─".repeat(40)}`);
  for (const p of projects) {
    console.log(
      `${String(p.count).padEnd(9)} ${fmtDate(p.mtime).padEnd(12)} ${p.label}`
    );
  }
  console.log("");
  console.log(
    `Re-run with --project <name> or --dir <path> to list sessions of one project.`
  );
}

export function cmdSessionsList(args, opts = {}) {
  const engineFlag = args.flags.engine;
  if (engineFlag === true) {
    throw new Error("--engine requires a value (apx, claude, codex, antigravity)");
  }
  const engineId = engineFlag ? String(engineFlag) : "apx";
  const engine = ENGINES[engineId];
  if (!engine) {
    throw new Error(
      `unknown engine "${engineId}" — valid engines: ${Object.keys(ENGINES).join(", ")}`
    );
  }

  const detected = engine.detect(opts);
  if (!detected.available) {
    console.log(`engine "${engine.id}" not available: ${detected.reason}`);
    return;
  }
  if (!engine.implemented) {
    console.log(
      `engine "${engine.id}" (${engine.label}) is detected but session listing is not implemented yet.`
    );
    return;
  }

  const dir = resolveTargetDir(args, opts);
  const limitFlag = args.flags.limit || args.flags.last;
  const limit = limitFlag && limitFlag !== true ? parseInt(limitFlag, 10) : null;

  if (dir) {
    printSessions(engine, dir, engine.listSessions(dir, opts), limit);
  } else {
    printProjects(engine, engine.listProjects(opts));
  }
}
