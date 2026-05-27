// daemon/skills-loader.js
// Discover and load APX skills on-demand for the super-agent.
//
// The super-agent reads skills from immutable INTERNAL sources under the
// package root — they ship with apx and can never be deleted by the user.
// This guarantees apx/apc/runtime knowledge is always available regardless
// of what the user does to ~/.apx/skills/ or per-project overrides.
//
// Discovery order (priority high → low):
//   1. <projectPath>/.apc/skills/<slug>.md           ← project-scoped (flat)
//   1b.<projectPath>/.apc/skills/<slug>/SKILL.md     ← project-scoped (dir)
//   2. ~/.apx/skills/<slug>/SKILL.md                 ← user-installed global
//   3. <packageRoot>/skills/<slug>/SKILL.md          ← bundled core skills
//                                                     (apx, apc-context)
//   4. <packageRoot>/src/core/runtime-skills/<slug>.md
//                                                     (claude-code, codex-cli,
//                                                      opencode-cli, openrouter)
//
// A slug found in a higher-priority location SHADOWS lower ones. A user can
// override the bundled apc-context by dropping `~/.apx/skills/apc-context/SKILL.md`,
// but the bundled copy stays in the package as a safety net.
//
// Note: the bundled `apc-context` skill is REFRESHED from the canonical apc
// repo on every npm install / update (see src/interfaces/cli/postinstall.js). APC is a
// living standard, so its skill content is not pinned to an apx version.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

const RUNTIME_SKILLS_DIR = path.join(PACKAGE_ROOT, "src", "core", "runtime-skills");
const BUNDLED_SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");
const GLOBAL_DIR         = path.join(os.homedir(), ".apx", "skills");

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[m[1]] = val;
  }
  return { fm, body };
}

// ---------------------------------------------------------------------------
// Directory scanners
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

  // priority 3: bundled core skills (apx, apc-context)
  found.push(...scanDirStyle(BUNDLED_SKILLS_DIR, "builtin"));

  // priority 4: runtime docs (claude-code, codex-cli, opencode-cli, openrouter)
  found.push(...scanFlatStyle(RUNTIME_SKILLS_DIR, "builtin"));

  // dedupe by slug (first-wins = higher priority shadows lower)
  const seen = new Set();
  const result = [];
  for (const entry of found) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);

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
 * Load the full body of a skill (frontmatter stripped if present). Resolves
 * via the same priority chain as listSkills().
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
    description: entry.description || fm.description || "",
    frontmatter: fm,
    body: body.trim(),
  };
}

// Useful for diagnostics
export const SKILL_LOCATIONS = {
  runtime_skills: RUNTIME_SKILLS_DIR,
  bundled: BUNDLED_SKILLS_DIR,
  global: GLOBAL_DIR,
};
