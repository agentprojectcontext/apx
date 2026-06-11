// Core parsers for APC — pure ESM, no deps.
import fs from "node:fs";
import path from "node:path";

export const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
const H1_RE = /^#\s+Agents\s*$/i;
const H2_RE = /^##\s+(\S.*?)\s*$/;
const FIELD_RE = /^-\s+\*\*([^*]+?)\*\*\s*:\s*(.*)$/;
const INDENT_CONT_RE = /^\s{2,}\S/;
const LIST_FIELDS = new Set(["Skills", "Tools"]);

// ---------------------------------------------------------------------------
// AGENTS.md parser (legacy / Codex compat source)
// ---------------------------------------------------------------------------

export function parseAgentsMd(text) {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "");
  const lines = stripped.split(/\r?\n/);
  const agents = [];
  let current = null;
  let pendingField = null;
  let seenH1 = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (H1_RE.test(line)) { seenH1 = true; continue; }
    const mH2 = line.match(H2_RE);
    if (mH2 && seenH1) {
      const slug = mH2[1].trim();
      if (SLUG_RE.test(slug)) {
        current = { slug, fields: {} };
        agents.push(current);
        pendingField = null;
      } else {
        current = null; pendingField = null;
      }
      continue;
    }
    if (!current) continue;
    const mField = line.match(FIELD_RE);
    if (mField) {
      const name = mField[1].trim();
      const value = mField[2].trim();
      current.fields[name] = LIST_FIELDS.has(name)
        ? value.split(",").map((s) => s.trim()).filter(Boolean)
        : value;
      pendingField = name;
      continue;
    }
    if (pendingField && INDENT_CONT_RE.test(raw)) {
      const existing = current.fields[pendingField];
      if (!Array.isArray(existing)) {
        current.fields[pendingField] = existing ? `${existing} ${raw.trim()}` : raw.trim();
      }
      continue;
    }
    if (line.trim() === "") pendingField = null;
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Per-agent file parser  (.apc/agents/<slug>.md)
// ---------------------------------------------------------------------------

export function parseAgentFile(slug, text) {
  // Extract frontmatter
  const fm = parseSessionFrontmatter(text);

  // Body = everything after the closing ---
  let body = "";
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end !== -1) body = text.slice(end + 5).trim();
  } else {
    body = text.trim();
  }

  // Normalize keys to Title-case to stay consistent with AGENTS.md output
  const fields = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k === "slug") continue;
    const key = k.charAt(0).toUpperCase() + k.slice(1);
    fields[key] = LIST_FIELDS.has(key)
      ? String(v).split(",").map((s) => s.trim()).filter(Boolean)
      : v;
  }

  return { slug, fields, body };
}

// Read all .apc/agents/<slug>.md files. Returns [] if none exist.
export function readAgentsFromDir(root) {
  const dir = path.join(root, ".apc", "agents");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && SLUG_RE.test(f.slice(0, -3)))
    .sort()
    .map((f) => {
      const slug = f.slice(0, -3);
      return parseAgentFile(slug, fs.readFileSync(path.join(dir, f), "utf8"));
    });
}

// ---------------------------------------------------------------------------
// Vault — global, project-agnostic agent templates.
// Two-layer model:
//   - BUNDLED  → assets/agent-vault-defaults/<slug>.md, shipped with APX,
//                always visible. Read-only on the user's machine.
//   - USER     → ~/.apx/agents/<slug>.md, the user's own additions and
//                overrides on top of the bundle. User layer wins per-slug.
//   - REMOVED  → ~/.apx/agents/.removed.json, tombstones (slugs the user
//                explicitly deleted). Hidden from listings until restored.
// Reading: BUNDLED ∪ USER, dedup by slug (user wins), filter tombstones.
// Writing: always to the USER layer (copy-on-write). Removing: tombstones
// if it's a bundled slug, deletes the user file otherwise.
// ---------------------------------------------------------------------------

import os from "node:os";
import { fileURLToPath } from "node:url";

const __parserDir = path.dirname(fileURLToPath(import.meta.url));

export const VAULT_DIR = path.join(os.homedir(), ".apx", "agents");
export const BUNDLED_VAULT_DIR = path.resolve(__parserDir, "../../../assets/agent-vault-defaults");
export const VAULT_TOMBSTONE_PATH = path.join(VAULT_DIR, ".removed.json");

function readVaultDirRaw(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && SLUG_RE.test(f.slice(0, -3)))
    .sort()
    .map((f) => ({ slug: f.slice(0, -3), file: path.join(dir, f) }));
}

export function readVaultTombstones() {
  if (!fs.existsSync(VAULT_TOMBSTONE_PATH)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(VAULT_TOMBSTONE_PATH, "utf8"));
    return new Set(Array.isArray(raw.slugs) ? raw.slugs : []);
  } catch { return new Set(); }
}

export function writeVaultTombstones(slugs) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(
    VAULT_TOMBSTONE_PATH,
    JSON.stringify({ slugs: [...slugs].sort() }, null, 2) + "\n",
  );
}

export function readVaultAgents({ includeRemoved = false } = {}) {
  const tombstones = readVaultTombstones();
  // Build a map slug → { agent, source }. User layer overrides bundled.
  const bySlug = new Map();
  for (const { slug, file } of readVaultDirRaw(BUNDLED_VAULT_DIR)) {
    if (!includeRemoved && tombstones.has(slug)) continue;
    const agent = parseAgentFile(slug, fs.readFileSync(file, "utf8"));
    bySlug.set(slug, { ...agent, source: "bundled" });
  }
  for (const { slug, file } of readVaultDirRaw(VAULT_DIR)) {
    if (!includeRemoved && tombstones.has(slug)) continue;
    const agent = parseAgentFile(slug, fs.readFileSync(file, "utf8"));
    const overrides = bySlug.has(slug);
    bySlug.set(slug, { ...agent, source: overrides ? "user-override" : "user" });
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

// Resolve a single vault agent honoring the layered model. Returns null when
// the slug is missing or tombstoned (unless includeRemoved is true).
function readVaultAgent(slug, { includeRemoved = false } = {}) {
  if (!includeRemoved && readVaultTombstones().has(slug)) return null;
  const userPath = path.join(VAULT_DIR, `${slug}.md`);
  if (fs.existsSync(userPath)) {
    const agent = parseAgentFile(slug, fs.readFileSync(userPath, "utf8"));
    const overrides = fs.existsSync(path.join(BUNDLED_VAULT_DIR, `${slug}.md`));
    return { ...agent, source: overrides ? "user-override" : "user" };
  }
  const bundledPath = path.join(BUNDLED_VAULT_DIR, `${slug}.md`);
  if (fs.existsSync(bundledPath)) {
    const agent = parseAgentFile(slug, fs.readFileSync(bundledPath, "utf8"));
    return { ...agent, source: "bundled" };
  }
  return null;
}

// Resolve a single agent for a project: local file → vault (layered) → null.
export function resolveAgent(root, slug) {
  const localPath = path.join(root, ".apc", "agents", `${slug}.md`);
  if (fs.existsSync(localPath)) {
    const agent = parseAgentFile(slug, fs.readFileSync(localPath, "utf8"));
    return { ...agent, source: "local" };
  }
  return readVaultAgent(slug);
}

// Exported for callers (CLI rm/edit, API DELETE/PATCH) that need to know
// whether a slug is user-layer, bundled, or absent before acting.
export { readVaultAgent };

// Return slugs imported from vault in this project (from project.json)
export function importedVaultSlugs(root) {
  const p = path.join(root, ".apc", "project.json");
  if (!fs.existsSync(p)) return [];
  try {
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    return cfg.agents?.imported ?? [];
  } catch { return []; }
}

// Primary entry point.
// Resolution order:
//   1. .apc/agents/<slug>.md  (local — overrides everything)
//   2. ~/.apx/agents/<slug>.md  (vault — for imported slugs)
//   3. Legacy hand-written AGENTS.md (not auto-generated)
export function readAgents(root) {
  const fromFiles = readAgentsFromDir(root).map((a) => ({ ...a, source: "local" }));
  const localSlugs = new Set(fromFiles.map((a) => a.slug));

  // Vault agents imported into this project
  const imported = importedVaultSlugs(root);
  const vaultAgents = imported
    .filter((slug) => !localSlugs.has(slug))
    .map((slug) => {
      const vaultPath = path.join(VAULT_DIR, `${slug}.md`);
      if (!fs.existsSync(vaultPath)) return null;
      const agent = parseAgentFile(slug, fs.readFileSync(vaultPath, "utf8"));
      return { ...agent, source: "vault" };
    })
    .filter(Boolean);

  const all = [...fromFiles, ...vaultAgents];
  const allSlugs = new Set(all.map((a) => a.slug));

  const agentsMdPath = path.join(root, "AGENTS.md");
  if (!fs.existsSync(agentsMdPath)) return all;

  const mdText = fs.readFileSync(agentsMdPath, "utf8");
  if (mdText.includes("Auto-generated from .apc/agents/")) return all;

  // Legacy hand-written AGENTS.md
  const legacy = parseAgentsMd(mdText)
    .filter((a) => !allSlugs.has(a.slug))
    .map((a) => ({ ...a, source: "legacy" }));
  return [...all, ...legacy];
}

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------

export function findApfRoot(start = process.cwd()) {
  let cur = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(cur, ".apc", "project.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// ---------------------------------------------------------------------------
// Session / conversation frontmatter
// ---------------------------------------------------------------------------

export function parseSessionFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const out = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
