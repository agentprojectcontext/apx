// Core parsers for APC — pure ESM, no deps.
import fs from "node:fs";
import path from "node:path";
import { AGENT_VAULT_DIR } from "../config/paths.js";
import {
  apcAgentsDir,
  apcAgentFile,
  apcProjectFile,
  isApcProject,
} from "./paths.js";

export const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
const LIST_FIELDS = new Set(["Skills", "Tools"]);


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
  const dir = apcAgentsDir(root);
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

import { fileURLToPath } from "node:url";
import { parseFrontmatterFields } from "./frontmatter.js";
import { readJson } from "#core/util/json-file.js";

const __parserDir = path.dirname(fileURLToPath(import.meta.url));

export const VAULT_DIR = AGENT_VAULT_DIR;
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
  const raw = readJson(VAULT_TOMBSTONE_PATH, {});
  return new Set(Array.isArray(raw?.slugs) ? raw.slugs : []);
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

// WHERE a vault slug's definition actually lives, honoring the layered model:
// user file wins, bundled default is the fallback, a tombstoned slug resolves
// to nothing. Returns null when the slug is unusable or absent.
//
// Every caller that needs the FILE — the import tool, `apx agent import`,
// readAgents() resolving an imported slug — must come through here. Each of
// them used to build `path.join(VAULT_DIR, slug + ".md")` by hand, which sees
// ONLY the user layer: on a machine where ~/.apx/agents holds nothing (the
// normal state — the bundle is the vault most people ever use), every bundled
// agent looked missing while list_vault_agents listed it happily. Importing
// one failed with "not found in vault. Available: <the very slug you asked
// for>", and an already-imported one silently vanished from its project.
export function vaultAgentFile(slug, { includeRemoved = false } = {}) {
  if (!slug || !SLUG_RE.test(slug)) return null;
  if (!includeRemoved && readVaultTombstones().has(slug)) return null;
  const userPath = path.join(VAULT_DIR, `${slug}.md`);
  if (fs.existsSync(userPath)) return userPath;
  const bundledPath = path.join(BUNDLED_VAULT_DIR, `${slug}.md`);
  if (fs.existsSync(bundledPath)) return bundledPath;
  return null;
}

// Resolve a single vault agent honoring the layered model. Returns null when
// the slug is missing or tombstoned (unless includeRemoved is true).
function readVaultAgent(slug, { includeRemoved = false } = {}) {
  const file = vaultAgentFile(slug, { includeRemoved });
  if (!file) return null;
  const agent = parseAgentFile(slug, fs.readFileSync(file, "utf8"));
  if (path.dirname(file) !== VAULT_DIR) return { ...agent, source: "bundled" };
  const overrides = fs.existsSync(path.join(BUNDLED_VAULT_DIR, `${slug}.md`));
  return { ...agent, source: overrides ? "user-override" : "user" };
}

// Resolve a single agent for a project: local file → vault (layered) → null.
export function resolveAgent(root, slug) {
  const localPath = apcAgentFile(root, slug);
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
  const p = apcProjectFile(root);
  if (!fs.existsSync(p)) return [];
  return readJson(p, {})?.agents?.imported ?? [];
}

// Primary entry point.
// Resolution order:
//   1. .apc/agents/<slug>.md  (local — overrides everything)
//   2. ~/.apx/agents/<slug>.md  (vault — for imported slugs)
// AGENTS.md is the project's startup-rules file, never an agent registry.
export function readAgents(root) {
  const fromFiles = readAgentsFromDir(root).map((a) => ({ ...a, source: "local" }));
  const localSlugs = new Set(fromFiles.map((a) => a.slug));

  // Vault agents imported into this project
  const imported = importedVaultSlugs(root);
  const vaultAgents = imported
    .filter((slug) => !localSlugs.has(slug))
    .map((slug) => {
      // includeRemoved: hiding a template from the vault listing must not
      // delete the agent out of a project that already imported it.
      const vaultPath = vaultAgentFile(slug, { includeRemoved: true });
      if (!vaultPath) return null;
      const agent = parseAgentFile(slug, fs.readFileSync(vaultPath, "utf8"));
      return { ...agent, source: "vault" };
    })
    .filter(Boolean);

  return [...fromFiles, ...vaultAgents];
}

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------

export function findApfRoot(start = process.cwd()) {
  let cur = path.resolve(start);
  while (true) {
    if (isApcProject(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// ---------------------------------------------------------------------------
// Session / conversation frontmatter
// ---------------------------------------------------------------------------

// Kept as the public name; the implementation is the shared parser.
export const parseSessionFrontmatter = parseFrontmatterFields;
