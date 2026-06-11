// Native Grep tool for APX — searches file contents by regex pattern.
// Tries ripgrep (rg) first for speed, falls back to pure Node.js walk.
//
// Endpoint: POST /tools/grep   body: { pattern, path?, glob?, case_sensitive?, context?, limit? }
//           GET  /tools/grep?pattern=...&path=...

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// ripgrep backend
// ---------------------------------------------------------------------------

async function grepWithRg({ pattern, searchPath, glob, caseSensitive, context = 0, limit }) {
  const args = [
    "--json",
    "--max-count", "1",           // max matches per file
    "--max-filesize", "1M",
    "-l",                         // list matching files first? No, we want content
  ];
  // Actually use full output mode
  const fullArgs = [
    "--json",
    "--max-filesize", "1M",
    "-n",                         // line numbers
  ];
  if (!caseSensitive) fullArgs.push("-i");
  if (context > 0) fullArgs.push("-C", String(context));
  if (glob) fullArgs.push("--glob", glob);
  fullArgs.push(pattern, searchPath);

  const { stdout } = await execFileAsync("rg", fullArgs, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 15000,
  });

  const matches = [];
  let currentFile = null;

  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === "match") {
      const file = obj.data?.path?.text || currentFile;
      currentFile = file;
      const lineNum = obj.data?.line_number;
      const text = obj.data?.lines?.text?.replace(/\n$/, "") || "";
      const last = matches[matches.length - 1];
      if (last && last.file === file) {
        last.matches.push({ line: lineNum, text });
      } else {
        matches.push({ file: path.relative(searchPath, file), absolute: file, matches: [{ line: lineNum, text }] });
      }
      if (matches.reduce((s, m) => s + m.matches.length, 0) >= limit) break;
    }
  }
  return { backend: "rg", matches };
}

// ---------------------------------------------------------------------------
// Pure Node.js fallback
// ---------------------------------------------------------------------------

function globToRegex(g) {
  return new RegExp(
    "^" + g
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "(?:.+/)?")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]") +
    "$"
  );
}

function walkFiles(dir, { globPattern, dot = false, maxFiles = 2000 } = {}) {
  const globRe = globPattern ? globToRegex(globPattern) : null;
  const result = [];
  const queue = [dir];
  while (queue.length && result.length < maxFiles) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!dot && e.name.startsWith(".")) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) { queue.push(full); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(dir, full);
      if (globRe && !globRe.test(rel) && !globRe.test(e.name)) continue;
      result.push(full);
    }
  }
  return result;
}

async function grepWithNode({ pattern, searchPath, glob, caseSensitive, context = 0, limit }) {
  const re = new RegExp(pattern, caseSensitive ? "" : "i");
  const files = walkFiles(searchPath, { globPattern: glob, dot: false });
  const matches = [];
  let totalMatches = 0;

  for (const file of files) {
    if (totalMatches >= limit) break;
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    const lines = content.split("\n");
    const fileMatches = [];

    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length - 1, i + context);
      const contextLines = [];
      for (let j = start; j <= end; j++) {
        contextLines.push({ line: j + 1, text: lines[j], is_match: j === i });
      }
      fileMatches.push({ line: i + 1, text: lines[i], context: context > 0 ? contextLines : undefined });
      totalMatches++;
      if (totalMatches >= limit) break;
    }

    if (fileMatches.length > 0) {
      matches.push({
        file: path.relative(searchPath, file),
        absolute: file,
        matches: fileMatches,
      });
    }
  }
  return { backend: "node", matches };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function grepFiles({
  pattern,
  path: searchPathArg,
  glob,
  case_sensitive = false,
  context = 0,
  limit = 100,
  cwd,
}) {
  if (!pattern) throw new Error("pattern required");
  const basePath = path.resolve(searchPathArg || cwd || process.cwd());
  if (!fs.existsSync(basePath)) throw new Error(`path does not exist: ${basePath}`);

  const lim = Math.min(parseInt(limit, 10) || 100, 1000);
  const ctx = Math.min(parseInt(context, 10) || 0, 10);

  // Validate the regex
  try { new RegExp(pattern); } catch (e) { throw new Error(`invalid regex: ${e.message}`); }

  let result;
  try {
    result = await grepWithRg({
      pattern,
      searchPath: basePath,
      glob,
      caseSensitive: !!case_sensitive,
      context: ctx,
      limit: lim,
    });
  } catch {
    result = await grepWithNode({
      pattern,
      searchPath: basePath,
      glob,
      caseSensitive: !!case_sensitive,
      context: ctx,
      limit: lim,
    });
  }

  const totalMatches = result.matches.reduce((s, m) => s + m.matches.length, 0);
  return {
    pattern,
    path: basePath,
    glob: glob || null,
    case_sensitive: !!case_sensitive,
    backend: result.backend,
    files_with_matches: result.matches.length,
    total_matches: totalMatches,
    truncated: totalMatches >= lim,
    matches: result.matches,
  };
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildGrepRouter(express) {
  const router = express.Router();

  async function handle(params, res) {
    try {
      res.json(await grepFiles(params));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  router.post("/", (req, res) => handle(req.body || {}, res));
  router.get("/", (req, res) => handle(req.query, res));

  return router;
}
