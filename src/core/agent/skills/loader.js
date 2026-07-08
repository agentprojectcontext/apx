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
//   3. <packageRoot>/src/core/runtime-skills/<slug>/SKILL.md
//                                                     ← runtime-internal set
//                                                       (rich apx-*, apc-context,
//                                                       claude-code, codex-cli,
//                                                       opencode-cli, openrouter)
//
// A slug found in a higher-priority location SHADOWS lower ones. The user can
// override any runtime skill by dropping `~/.apx/skills/<slug>/SKILL.md`; the
// in-repo copy stays as a safety net.
//
// NOTE: <packageRoot>/skills/<slug>/SKILL.md is intentionally NOT in this chain.
// That dir holds the engine-side slim set replicated to external CLIs/IDEs
// (~/.claude/skills/, ~/.codex/skills/, ...) — it's not for the super-agent.
//
// Note: the bundled `apc-context` skill is REFRESHED from the canonical apc
// repo on every npm install / update (see src/interfaces/cli/postinstall.js). APC is a
// living standard, so its skill content is not pinned to an apx version.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { apcSkillsDir } from "#core/apc/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
// Four levels up: __dirname = src/core/agent/skills/ → agent/ → core/ → src/
// → repo root. Used to find the bundled skills/ folder at the repo root.
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

// Runtime-internal skills — full apx-* catalog + CLI docs. Lives outside
// <packageRoot>/skills/ so external tools that copy "skills/" from the repo
// don't accidentally pull the rich set or the runtime CLI docs.
const BUILTIN_SKILLS_DIR = path.join(PACKAGE_ROOT, "src", "core", "runtime-skills");
const GLOBAL_DIR         = path.join(os.homedir(), ".apx", "skills");

// ---------------------------------------------------------------------------
// Frontmatter parsing (minimal — handles the YAML we ship)
// ---------------------------------------------------------------------------

// Keys whose value is a YAML list (inline `[a, b]` or dash-list). Everything
// else stays a scalar string — the parser must not regress existing SKILL.md
// frontmatter, so list handling is opt-in per key.
const LIST_KEYS = new Set(["triggers"]);

function stripQuotes(val) {
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

function parseInlineList(val) {
  // "[a, b, "c d"]" → ["a", "b", "c d"]
  const inner = val.slice(1, -1);
  return inner
    .split(",")
    .map((s) => stripQuotes(s.trim()))
    .filter(Boolean);
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fm: {}, body: raw };

  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");

  const fm = {};
  const lines = fmBlock.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();

    if (LIST_KEYS.has(key)) {
      if (val.startsWith("[") && val.endsWith("]")) {
        fm[key] = parseInlineList(val);
        continue;
      }
      if (val === "") {
        // Dash-list: consume following "  - item" lines (must be indented so
        // they can't be confused with a top-level key).
        const items = [];
        while (i + 1 < lines.length) {
          const dm = lines[i + 1].match(/^\s+-\s+(.+)$/);
          if (!dm) break;
          items.push(stripQuotes(dm[1].trim()));
          i++;
        }
        fm[key] = items;
        continue;
      }
      // A scalar under a list key ("triggers: deploy") — treat as 1-item list.
      fm[key] = [stripQuotes(val)];
      continue;
    }

    fm[key] = stripQuotes(val);
  }
  return { fm, body };
}

/** Normalize a frontmatter `triggers` value to a clean array of strings. */
function normalizeTriggers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((t) => String(t || "").trim())
    .filter(Boolean);
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
 * @returns {Array<{slug, source, description, triggers, file}>}
 */
export function listSkills({ projectPath } = {}) {
  const found = [];

  // priority 1: project-scoped
  if (projectPath) {
    const apcSkills = apcSkillsDir(projectPath);
    found.push(...scanDirStyle(apcSkills, "project"));
    found.push(...scanFlatStyle(apcSkills, "project"));
  }

  // priority 2: user-installed global
  found.push(...scanDirStyle(GLOBAL_DIR, "global"));

  // priority 3: runtime-internal builtin set
  // (rich apx-*, apc-context, plus claude-code, codex-cli, opencode-cli, openrouter)
  found.push(...scanDirStyle(BUILTIN_SKILLS_DIR, "builtin"));

  // dedupe by slug (first-wins = higher priority shadows lower)
  const seen = new Set();
  const result = [];
  for (const entry of found) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);

    let description = "";
    let triggers = [];
    try {
      const raw = fs.readFileSync(entry.file, "utf8");
      const { fm } = parseFrontmatter(raw);
      description = fm.description || "";
      triggers = normalizeTriggers(fm.triggers);
    } catch { /* unreadable — skip description */ }

    result.push({
      slug: entry.slug,
      source: entry.source,
      description,
      triggers,
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
 * @returns {{slug, source, file, description, triggers, body, frontmatter}}
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
    triggers: normalizeTriggers(fm.triggers),
    frontmatter: fm,
    body: body.trim(),
  };
}

// Useful for diagnostics
export const SKILL_LOCATIONS = {
  builtin: BUILTIN_SKILLS_DIR,
  global: GLOBAL_DIR,
};
