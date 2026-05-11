// daemon/skills-loader.js
// Discover and load APX skills on-demand for the super-agent.
//
// The super-agent reads skills from immutable INTERNAL sources under
// src/core/ — they ship with apx and can never be deleted by the user. This
// guarantees apx/apc/runtime knowledge is always available regardless of
// what the user does to ~/.apx/skills/. Distribution copies under
// <package>/skills/ are a separate concern (scaffold.js handles them) and
// the loader does NOT read from there.
//
// Discovery order (priority high → low):
//   1. <projectPath>/.apc/skills/<slug>.md          ← project-scoped
//   1b.<projectPath>/.apc/skills/<slug>/SKILL.md    ← same, dir-style
//   2. ~/.apx/skills/<slug>/SKILL.md                ← user-installed global
//   3. <packageRoot>/src/core/runtime-skills/<slug>.md ← built-in runtime docs
//                                                       (claude-code, codex-cli,
//                                                       opencode-cli, openrouter)
//   4. <packageRoot>/src/core/apx-skill.md          ← built-in intrinsic apx
//   4b.<packageRoot>/src/core/apc-context-skill.md  ← built-in intrinsic apc-context
//
// A slug found in a higher-priority location SHADOWS lower ones — so a user
// who drops `~/.apx/skills/apx/SKILL.md` overrides the intrinsic one, but the
// intrinsic stays in the package as a safety net.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

const RUNTIME_SKILLS_DIR = path.join(PACKAGE_ROOT, "src", "core", "runtime-skills");
const GLOBAL_DIR         = path.join(os.homedir(), ".apx", "skills");
const CORE_DIR           = path.join(PACKAGE_ROOT, "src", "core");

// Intrinsic built-in skills whose source files (src/core/*-skill.md) do NOT
// carry frontmatter — the scaffold.js wrapper adds frontmatter when copying
// these out to external IDE skill dirs. For the super-agent's catalog we
// supply slug + description inline. Keep in sync with scaffold.js.
const INTRINSIC = [
  {
    slug: "apx",
    file: path.join(CORE_DIR, "apx-skill.md"),
    description:
      "APX CLI skill. Activate when: user asks to run or coordinate agents, " +
      "use MCP tools from .apc/mcps.json, install agents from a team workspace, " +
      "or explicitly mentions apx commands. Do NOT activate just because .apc/ exists — " +
      "that is handled by the apc-context skill. Activate on: 'apx run', 'apx exec', " +
      "'run an agent', 'coordinate agents', 'MCP not working', 'install agent', " +
      "'team agents', 'apx memory', 'daemon'.",
  },
  {
    slug: "apc-context",
    file: path.join(CORE_DIR, "apc-context-skill.md"),
    description:
      "ALWAYS activate when the project has a .apc/ directory or AGENTS.md file. " +
      "Do not wait to be asked. Read .apc/ before making any assumption about agents, " +
      "memory, or project structure. Activate on: .apc/, AGENTS.md, 'which agents', " +
      "'list agents', 'agent context', 'who are the agents', any question about agents " +
      "or memory in this project. IMPORTANT: if .apc/migrate.md exists, open the " +
      "conversation with a migration offer before answering anything else. If the user " +
      "declines, delete .apc/migrate.md immediately so it is not shown again.",
  },
];

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

  // priority 3: built-in runtime docs (have frontmatter)
  found.push(...scanFlatStyle(RUNTIME_SKILLS_DIR, "builtin"));

  // priority 4: intrinsic built-ins (no frontmatter — descriptions hardcoded)
  for (const it of INTRINSIC) {
    if (fs.existsSync(it.file)) {
      found.push({ slug: it.slug, source: "builtin", file: it.file, _description: it.description });
    }
  }

  // dedupe by slug (first-wins = higher priority shadows lower)
  const seen = new Set();
  const result = [];
  for (const entry of found) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);

    // Description: prefer inline (intrinsic) → frontmatter → empty
    let description = entry._description || "";
    if (!description) {
      try {
        const raw = fs.readFileSync(entry.file, "utf8");
        const { fm } = parseFrontmatter(raw);
        description = fm.description || "";
      } catch { /* unreadable — skip description */ }
    }

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
  intrinsic: CORE_DIR,
  global: GLOBAL_DIR,
};
