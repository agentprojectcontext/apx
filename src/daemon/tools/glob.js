// daemon/tools/glob.js
// Native Glob tool for APX — lists files matching a glob pattern.
// Uses Node.js built-in glob (v22+) with graceful fallback to manual walk.
//
// Endpoint: POST /tools/glob   body: { pattern, cwd?, dot?, absolute? }
//           GET  /tools/glob?pattern=**/*.js&cwd=/path

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Core glob implementation — uses native Node.js glob (v22+) or manual walk
// ---------------------------------------------------------------------------

/** Minimal glob implementation using fs.readdirSync + regex conversion */
function globToRegex(pattern) {
  // Convert glob to regex
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (NOT * ? {})
    .replace(/\*\*\//g, "(?:.+/)?")        // **/ → match any directory depth
    .replace(/\*\*/g, ".*")                // ** → match anything
    .replace(/\*/g, "[^/]*")              // * → match within directory
    .replace(/\?/g, "[^/]");              // ? → single char
  return new RegExp(`^${re}$`);
}

function walkDir(dir, { dot = false, maxFiles = 5000 } = {}) {
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
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        results.push(full);
      }
    }
  }
  return results;
}

export async function globFiles({ pattern, cwd, dot = false, absolute = false, limit = 500 }) {
  if (!pattern) throw new Error("pattern required");
  const base = path.resolve(cwd || process.cwd());

  if (!fs.existsSync(base)) throw new Error(`cwd does not exist: ${base}`);

  let files;

  // Try native Node.js glob first (available in Node 22+)
  try {
    const { glob: nodeGlob } = await import("node:fs/promises");
    const matches = [];
    for await (const f of nodeGlob(pattern, { cwd: base, dot, absolute: true })) {
      matches.push(f);
      if (matches.length >= limit) break;
    }
    files = matches;
  } catch {
    // Fallback: manual walk + regex match
    const re = globToRegex(pattern);
    const allFiles = walkDir(base, { dot, maxFiles: limit * 4 });
    files = allFiles
      .map((f) => {
        const rel = path.relative(base, f);
        return { abs: f, rel };
      })
      .filter(({ rel }) => re.test(rel))
      .slice(0, limit)
      .map(({ abs }) => abs);
  }

  const lim = Math.min(parseInt(limit, 10) || 500, 5000);
  const result = files.slice(0, lim).map((f) => {
    const rel = path.relative(base, f);
    const stat = (() => { try { return fs.statSync(f); } catch { return null; } })();
    return absolute
      ? { path: f, relative: rel, size: stat?.size ?? null }
      : { path: rel, absolute: f, size: stat?.size ?? null };
  });

  return {
    pattern,
    cwd: base,
    count: result.length,
    truncated: files.length >= lim,
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
