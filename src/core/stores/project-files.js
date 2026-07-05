// Project file browser — a safe, sandboxed view of a project's own files.
//
// Powers the web /files browser and the /docs editor (same store, different
// root). Everything is resolved *inside* the project root; any path that would
// escape it throws. This is intentionally NOT a general filesystem API — it
// only ever touches files under one project.
//
// Two roots matter:
//   - project root  — the repo directory (whole-project /files browser)
//   - docs root      — a subfolder (config `docs.root`, default "docs") used by
//                      the /docs editor, so specs/casework live in one place
//                      (like Appsi's work/ folder of case folders).
//
// Reads classify by extension: text is returned inline (utf8); images under a
// size cap are returned base64 so the authenticated JSON API can render them
// without a separate unauthenticated asset route; anything else is reported as
// binary with no body (the UI shows metadata + a download affordance).
import fs from "node:fs";
import path from "node:path";

// Directories that are never useful to browse and would blow the node budget.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo", ".nuxt",
  "coverage", ".cache", ".venv", "venv", "__pycache__", ".pytest_cache",
  ".idea", ".vscode", ".DS_Store",
]);

const TEXT_EXTS = new Set([
  "md", "markdown", "mdx", "txt", "text", "rst", "adoc",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "jsonc", "json5",
  "css", "scss", "sass", "less", "html", "htm", "xml", "svg", "vue", "svelte",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cc",
  "cs", "php", "swift", "sh", "bash", "zsh", "fish", "sql", "graphql", "gql",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "properties",
  "csv", "tsv", "log", "gitignore", "dockerignore", "dockerfile", "makefile",
]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);

const IMAGE_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  avif: "image/avif",
};

// Guardrails.
const MAX_NODES = 4000;         // total tree entries returned
const MAX_TEXT_BYTES = 2_000_000;  // 2 MB inline text ceiling
const MAX_IMAGE_BYTES = 5_000_000; // 5 MB base64 image ceiling

function extOf(name) {
  const base = name.toLowerCase();
  if (base === "dockerfile" || base === "makefile") return base;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1);
}

export function classifyKind(name) {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

// Resolve `rel` inside `base`, refusing anything that escapes the sandbox.
function resolveWithin(base, rel = "") {
  const root = path.resolve(base);
  const clean = String(rel || "").replace(/^[/\\]+/, "");
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("path escapes the project root");
  }
  return { root, abs };
}

// The docs root for a project (config.docs.root, default "docs"), as a subpath
// relative to the project root. Sanitized so it can't escape.
export function docsSubdir(config) {
  const raw = config?.docs?.root;
  const sub = raw && typeof raw === "string" ? raw : "docs";
  return sub.replace(/^[/\\]+/, "").replace(/\.\.(?:[/\\]|$)/g, "");
}

// Recursively build a nested tree under `absDir`. Dirs first, then files, each
// alphabetical. `relPrefix` is the path relative to the sandbox root, which is
// what callers pass back to read/write.
function walk(absDir, relPrefix, budget) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  const files = [];
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith(".")) continue;      // hide dotfiles/dirs
    if (ent.isDirectory() && SKIP_DIRS.has(name)) continue;
    (ent.isDirectory() ? dirs : files).push(ent);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  const out = [];
  for (const ent of [...dirs, ...files]) {
    if (budget.count >= MAX_NODES) {
      budget.truncated = true;
      break;
    }
    budget.count += 1;
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      out.push({ name: ent.name, path: rel, type: "dir", children: walk(path.join(absDir, ent.name), rel, budget) });
    } else {
      out.push({ name: ent.name, path: rel, type: "file", kind: classifyKind(ent.name) });
    }
  }
  return out;
}

// List a tree. `opts.subdir` scopes the sandbox to a subfolder (used for docs).
// Returns { root, subdir, tree, truncated }. A missing dir yields an empty tree
// rather than an error — the UI treats that as "nothing here yet".
export function listTree(projectRoot, opts = {}) {
  const subdir = opts.subdir ? String(opts.subdir) : "";
  const { abs } = resolveWithin(projectRoot, subdir);
  const budget = { count: 0, truncated: false };
  const tree = fs.existsSync(abs) && fs.statSync(abs).isDirectory()
    ? walk(abs, "", budget)
    : [];
  return { root: projectRoot, subdir, tree, truncated: budget.truncated };
}

// Read a single file. `opts.subdir` scopes the sandbox (docs). Returns metadata
// plus the body when it's text/image; binary bodies are omitted.
export function readFile(projectRoot, relPath, opts = {}) {
  const base = opts.subdir ? path.join(projectRoot, opts.subdir) : projectRoot;
  const { abs } = resolveWithin(base, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const stat = fs.statSync(abs);
  const name = path.basename(abs);
  const kind = classifyKind(name);
  const common = {
    path: relPath.replace(/^[/\\]+/, ""),
    name,
    kind,
    size: stat.size,
    modified: stat.mtime.toISOString(),
  };
  if (kind === "image") {
    if (stat.size > MAX_IMAGE_BYTES) return { ...common, encoding: "binary", content: null, too_large: true };
    const ext = extOf(name);
    return {
      ...common,
      encoding: "base64",
      mime: IMAGE_MIME[ext] || "application/octet-stream",
      content: fs.readFileSync(abs).toString("base64"),
    };
  }
  if (kind === "binary") {
    return { ...common, encoding: "binary", content: null };
  }
  if (stat.size > MAX_TEXT_BYTES) {
    return { ...common, encoding: "binary", content: null, too_large: true };
  }
  return { ...common, encoding: "utf8", content: fs.readFileSync(abs, "utf8") };
}

// Write (create or overwrite) a text file, creating parent dirs as needed.
export function writeFile(projectRoot, relPath, content, opts = {}) {
  const base = opts.subdir ? path.join(projectRoot, opts.subdir) : projectRoot;
  const { abs } = resolveWithin(base, relPath);
  if (typeof content !== "string") throw new Error("content must be a string");
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory())
    throw new Error("path is a directory");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return { ok: true, path: relPath.replace(/^[/\\]+/, ""), bytes: Buffer.byteLength(content, "utf8") };
}

// Create a directory (mkdir -p).
export function makeDir(projectRoot, relPath, opts = {}) {
  const base = opts.subdir ? path.join(projectRoot, opts.subdir) : projectRoot;
  const { abs } = resolveWithin(base, relPath);
  fs.mkdirSync(abs, { recursive: true });
  return { ok: true, path: relPath.replace(/^[/\\]+/, "") };
}

// Delete a file or directory (recursive). Refuses to delete the sandbox root.
export function removeEntry(projectRoot, relPath, opts = {}) {
  const base = opts.subdir ? path.join(projectRoot, opts.subdir) : projectRoot;
  const { root, abs } = resolveWithin(base, relPath);
  if (abs === root) throw new Error("refusing to delete the root");
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs, { recursive: true, force: true });
  return true;
}
