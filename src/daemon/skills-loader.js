// daemon/skills-loader.js
// Discover and load APX skills on-demand for the super-agent.
//
// Skills are markdown files with YAML frontmatter (name, description, ...)
// — same format used by Claude Code, Cursor, etc. The super-agent does NOT
// inject them into its system prompt by default; instead it calls
// list_skills() / load_skill() as needed. This keeps baseline tokens at zero
// and only spends them on turns where the doc is actually relevant.
//
// Discovery order (priority high → low):
//   1. <projectPath>/.apc/skills/<slug>.md          ← project-scoped
//   1b.<projectPath>/.apc/skills/<slug>/SKILL.md    ← same, dir-style
//   2. ~/.apx/skills/<slug>/SKILL.md                ← user-installed global
//   3. <packageRoot>/skills/<slug>/SKILL.md         ← built-in (apx, apc-context)
//
// A slug found in a higher-priority location SHADOWS lower ones.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

const BUILTIN_DIR = path.join(PACKAGE_ROOT, "skills");
const GLOBAL_DIR  = path.join(os.homedir(), ".apx", "skills");

// ---------------------------------------------------------------------------
// Frontmatter parsing (minimal — handles the YAML we ship)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fm: {}, body: raw };

  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");

  const fm = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    // strip matching quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[m[1]] = val;
  }
  return { fm, body };
}

// ---------------------------------------------------------------------------
// Single-source discovery
// ---------------------------------------------------------------------------

/** Returns [{slug, source, file}] from a directory using <slug>/SKILL.md layout. */
function scanDirStyle(baseDir, source) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); }
  catch { return []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(baseDir, e.name, "SKILL.md");
    if (fs.existsSync(file)) out.push({ slug: e.name, source, file });
  }
  return out;
}

/** Returns [{slug, source, file}] from a directory using <slug>.md layout. */
function scanFlatStyle(baseDir, source) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); }
  catch { return []; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    if (e.name === "README.md") continue;
    out.push({
      slug: e.name.replace(/\.md$/, ""),
      source,
      file: path.join(baseDir, e.name),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover available skills across all locations.
 * Returns lightweight metadata only — body is NOT read.
 *
 * @param {object} opts
 * @param {string=} opts.projectPath  optional project root to also scan
 * @returns {Array<{slug, source, description, file}>}
 */
export function listSkills({ projectPath } = {}) {
  const found = [];

  // priority 1: project-scoped
  if (projectPath) {
    const apcSkills = path.join(projectPath, ".apc", "skills");
    found.push(...scanDirStyle(apcSkills, "project"));
    found.push(...scanFlatStyle(apcSkills, "project"));
  }

  // priority 2: user-installed global
  found.push(...scanDirStyle(GLOBAL_DIR, "global"));

  // priority 3: built-in
  found.push(...scanDirStyle(BUILTIN_DIR, "builtin"));

  // dedupe by slug (first-wins = higher priority shadows lower)
  const seen = new Set();
  const result = [];
  for (const entry of found) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);

    // Lazy parse just the frontmatter for the description.
    let description = "";
    try {
      const raw = fs.readFileSync(entry.file, "utf8");
      const { fm } = parseFrontmatter(raw);
      description = fm.description || "";
    } catch { /* unreadable — skip description */ }

    result.push({
      slug: entry.slug,
      source: entry.source,
      description,
      file: entry.file,
    });
  }
  return result;
}

/**
 * Load the full body of a skill (frontmatter stripped). Resolves via the
 * same priority chain as listSkills().
 *
 * @param {string} slug
 * @param {object} opts
 * @param {string=} opts.projectPath
 * @returns {{slug, source, file, description, body, frontmatter}}
 */
export function loadSkill(slug, { projectPath } = {}) {
  if (!slug) throw new Error("loadSkill: slug required");

  const list = listSkills({ projectPath });
  const entry = list.find(s => s.slug === slug);
  if (!entry) {
    throw new Error(`skill "${slug}" not found. Available: ${list.map(s => s.slug).join(", ") || "(none)"}`);
  }

  const raw = fs.readFileSync(entry.file, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  return {
    slug: entry.slug,
    source: entry.source,
    file: entry.file,
    description: fm.description || entry.description || "",
    frontmatter: fm,
    body: body.trim(),
  };
}

// Useful for diagnostics
export const SKILL_LOCATIONS = {
  builtin: BUILTIN_DIR,
  global: GLOBAL_DIR,
};
