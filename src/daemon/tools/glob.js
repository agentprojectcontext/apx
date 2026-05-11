// daemon/tools/glob.js
// Glob tool for APX — lists files matching a glob pattern.
// Backends, in order of preference:
//   1. fast-glob (npm)  — full glob spec, brace expansion, negation patterns
//   2. node:fs/promises glob  (Node 22+) — built-in, no extra dep
//   3. Manual walk + regex   — pure-JS fallback for older Node
//
// Endpoint: POST /tools/glob   body: { pattern, cwd?, dot?, absolute?, ignore?, limit? }
//           GET  /tools/glob?pattern=**/*.js&cwd=/path

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Manual fallback (pure JS — no glob lib, no Node 22+)
// ---------------------------------------------------------------------------

function globToRegex(pattern) {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.+/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${re}$`);
}

function walkDir(dir, { dot = false, maxFiles = 5000, ignoreFns = [] } = {}) {
  const results = [];
  const queue = [dir];
  while (queue.length && results.length < maxFiles) {
    const current = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      if (!dot && entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (ignoreFns.some(fn => fn(rel, full, entry.name))) continue;
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        results.push(full);
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

async function loadFastGlob() {
  try {
    const mod = await import("fast-glob");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function normalizeIgnore(ignore) {
  if (!ignore) return [];
  return Array.isArray(ignore) ? ignore.filter(Boolean).map(String) : [String(ignore)];
}

export async function globFiles({ pattern, cwd, dot = false, absolute = false, ignore, limit = 500 } = {}) {
  if (!pattern) throw new Error("pattern required");
  const base = path.resolve(cwd || process.cwd());
  if (!fs.existsSync(base)) throw new Error(`cwd does not exist: ${base}`);

  const ignoreList = normalizeIgnore(ignore);
  const lim = Math.min(parseInt(limit, 10) || 500, 5000);

  let files = [];
  let backend = "manual";

  // Backend 1: fast-glob
  const fg = await loadFastGlob();
  if (fg) {
    backend = "fast-glob";
    files = await fg(pattern, {
      cwd: base,
      dot,
      absolute: true,
      ignore: ignoreList,
      followSymbolicLinks: false,
      suppressErrors: true,
    });
    files = files.slice(0, lim + 1);
  } else {
    // Backend 2: Node 22+ native
    try {
      const { glob: nodeGlob } = await import("node:fs/promises");
      backend = "node-native";
      const ignoreRegexes = ignoreList.map(globToRegex);
      const matches = [];
      for await (const f of nodeGlob(pattern, { cwd: base, dot, absolute: true })) {
        const rel = path.relative(base, f);
        if (ignoreRegexes.some(re => re.test(rel) || re.test(path.basename(f)))) continue;
        matches.push(f);
        if (matches.length > lim) break;
      }
      files = matches;
    } catch {
      // Backend 3: pure-JS walk + regex
      backend = "manual";
      const re = globToRegex(pattern);
      const ignoreRegexes = ignoreList.map(globToRegex);
      const ignoreFns = [
        (rel, _full, name) => ignoreRegexes.some(r => r.test(rel) || r.test(name)),
      ];
      const all = walkDir(base, { dot, maxFiles: lim * 4, ignoreFns });
      files = all
        .filter(f => re.test(path.relative(base, f)))
        .slice(0, lim + 1);
    }
  }

  const truncated = files.length > lim;
  files = files.slice(0, lim);

  const result = files.map((f) => {
    const rel = path.relative(base, f);
    const stat = (() => { try { return fs.statSync(f); } catch { return null; } })();
    return absolute
      ? { path: f, relative: rel, size: stat?.size ?? null }
      : { path: rel, absolute: f, size: stat?.size ?? null };
  });

  return {
    pattern,
    cwd: base,
    backend,
    ignore: ignoreList,
    count: result.length,
    truncated,
    files: result,
  };
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildGlobRouter(express) {
  const router = express.Router();

  async function handle(params, res) {
    try {
      res.json(await globFiles(params));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  router.post("/", (req, res) => handle(req.body || {}, res));
  router.get("/", (req, res) => handle(req.query, res));

  return router;
}
