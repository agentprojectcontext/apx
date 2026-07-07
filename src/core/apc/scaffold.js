import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  VAULT_DIR,
  BUNDLED_VAULT_DIR,
  readVaultTombstones,
  writeVaultTombstones,
} from "./parser.js";
import { readApcContextSkill } from "./skill-sync.js";
import { nowIso } from "../util/time.js";
import {
  apcDir,
  apcProjectFile,
  apcAgentsDir,
  apcAgentFile,
  agentsMdFile,
} from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Now under src/core/apc/ — one more "../" to escape than before.
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..", "..");
// <packageRoot>/skills/<slug>/SKILL.md — the SLIM engine-side set: every skill
// here is replicated verbatim into project IDE rule files (`apx skills add`) and
// into ~/.<host>/skills/ (`apx skills sync`). The rich super-agent catalog lives
// at src/core/runtime-skills/ and is intentionally NOT copied out.
const BUNDLED_SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");

export const SPEC_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Bundled skills — single source of truth lives at <packageRoot>/skills/<slug>/SKILL.md
// with proper frontmatter. The `apc-context` copy is refreshed on every
// install/update from the canonical APC repo (see src/interfaces/cli/postinstall.js).
// ---------------------------------------------------------------------------

// Read one slim skill from <packageRoot>/skills/<slug>/SKILL.md. `apc-context`
// is special-cased to refresh from the canonical APC repo if available.
function readBundledSkill(slug) {
  if (slug === "apc-context") {
    const synced = readApcContextSkill();
    if (synced?.text) return synced.text;
  }
  const file = path.join(BUNDLED_SKILLS_DIR, slug, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

// Split frontmatter and body from a SKILL.md. Used by IDE targets that need
// to re-wrap the body in their own rule-file frontmatter.
function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { fm: "", body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fm: "", body: raw };
  const fm = raw.slice(0, end + 4);
  const body = raw.slice(end + 4).replace(/^\n/, "");
  return { fm, body };
}

// Pull description from frontmatter so cursor/.mdc rule files can advertise
// the same activation trigger.
function readDescription(raw) {
  const { fm } = splitFrontmatter(raw);
  const m = fm.match(/^description:\s*"?(.*?)"?\s*$/m);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// IDE skill targets — written during `apx init` and `apx skills add`
// ---------------------------------------------------------------------------

// Project-scoped targets (relative to project root).
// `ideDir` = the IDE's root config dir that must already exist for the target to apply.
export const IDE_TARGETS = [
  {
    id: "claude-code",
    label: "Claude Code",
    ideDir: ".claude",
    file: ".claude/skills/apx/SKILL.md",
    // Claude Code consumes SKILL.md with its native frontmatter as-is.
    render: (raw) => raw,
    append: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    ideDir: ".cursor",
    file: ".cursor/rules/apx.mdc",
    render: (raw) => {
      const { body } = splitFrontmatter(raw);
      const desc = readDescription(raw);
      return `---\ndescription: ${desc}\n---\n\n${body}`;
    },
    append: false,
  },
  {
    id: "windsurf",
    label: "Windsurf",
    ideDir: ".windsurf",
    file: ".windsurf/rules/apx.md",
    render: (raw) => {
      const { body } = splitFrontmatter(raw);
      const desc = readDescription(raw);
      return `---\ntrigger: model_decision\ndescription: ${desc}\n---\n\n${body}`;
    },
    append: false,
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    ideDir: ".github",
    file: ".github/copilot-instructions.md",
    render: (raw) => {
      const { body } = splitFrontmatter(raw);
      return `\n<!-- apx-skill -->\n${body}\n<!-- /apx-skill -->\n`;
    },
    append: true,
    guard: "<!-- apx-skill -->",
  },
  {
    id: "trae",
    label: "Trae",
    ideDir: ".trae",
    file: ".trae/rules/project_rules.md",
    render: (raw) => {
      const { body } = splitFrontmatter(raw);
      return `\n<!-- apx-skill -->\n${body}\n<!-- /apx-skill -->\n`;
    },
    append: true,
    guard: "<!-- apx-skill -->",
  },
];

// Global targets (absolute paths, use ~/<dir>/skills/<slug>/SKILL.md format).
// These dirs are read by Claude Code, Cursor (compat), and tools adopting the skills.sh spec.
const GLOBAL_SKILL_DIRS = [
  path.join(os.homedir(), ".claude", "skills"),    // Claude Code + Cursor legacy compat
  path.join(os.homedir(), ".cursor", "skills"),    // Cursor primary global path
  path.join(os.homedir(), ".codex",  "skills"),    // Codex (OpenAI)
  path.join(os.homedir(), ".agents", "skills"),    // Antigravity/other skills.sh adopters
];

// Install APX + APC context skills into IDE rule files. Returns an array of result objects.
// targetIds: array of target ids to install; null = all project targets.
// Writes the slim engine-side skill from <packageRoot>/skills/. The rich
// super-agent set in src/core/runtime-skills/ is intentionally never written
// into project IDE files.
export function installIdeSkills(root, targetIds = null) {
  const apxRaw = readBundledSkill("apx");
  const apcRaw = readBundledSkill("apc-context");
  if (!apxRaw) return [];

  const targets = targetIds
    ? IDE_TARGETS.filter((t) => targetIds.includes(t.id))
    : IDE_TARGETS;

  const results = [];
  for (const t of targets) {
    if (t.ideDir && !fs.existsSync(path.join(root, t.ideDir))) {
      results.push({ ...t, status: "skipped (IDE not present)" });
      continue;
    }

    const dest = path.join(root, t.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const rendered = t.render(apxRaw);
    if (t.append) {
      const existing = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
      if (t.guard && existing.includes(t.guard)) {
        results.push({ ...t, status: "already installed" });
      } else {
        fs.appendFileSync(dest, rendered, "utf8");
        results.push({ ...t, status: "appended" });
      }
    } else {
      const existed = fs.existsSync(dest);
      fs.writeFileSync(dest, rendered, "utf8");
      results.push({ ...t, status: existed ? "updated" : "created" });
    }

    // Install APC context skill alongside Claude Code (dir-style skills dir).
    if (apcRaw && t.id === "claude-code") {
      const apcDest = path.join(root, ".claude", "skills", "apc-context", "SKILL.md");
      fs.mkdirSync(path.dirname(apcDest), { recursive: true });
      const existed = fs.existsSync(apcDest);
      fs.writeFileSync(apcDest, apcRaw, "utf8");
      results.push({ ...t, id: "claude-code/apc-context", label: "Claude Code (apc-context)", file: apcDest, status: existed ? "updated" : "created" });
    }
  }
  return results;
}

// Discover every bundled skill under skills/<slug>/SKILL.md. Used by
// installGlobalSkills() so a new skill added to the repo automatically lands
// on the user's machine after `npm install -g .` (or `npm update -g @agentprojectcontext/apx`)
// without anyone having to touch this file.
//
// Excluded: directory names starting with "." (e.g. .DS_Store).
// Every slug under <packageRoot>/skills/ is part of the slim engine set and
// gets pushed to global dirs on `apx skills sync`. No scope filtering — the
// dir IS the contract.
export function listBundledSkillSlugs() {
  return discoverBundledSkills().map((s) => s.slug);
}

export function listBundledSkills() {
  return discoverBundledSkills().map(({ slug }) => ({ slug }));
}

// Backwards-compat alias — every bundled slug here IS an engine slug now.
export function listEngineSkills() {
  return listBundledSkills();
}

// Legacy slugs APX used to ship to global dirs but no longer does — exposed so
// the CLI can report what `installGlobalSkills` will prune.
export function listLegacyPruneSlugs() {
  return [...PRUNE_LEGACY_SLUGS];
}

function discoverBundledSkills() {
  const root = BUNDLED_SKILLS_DIR;
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const skillFile = path.join(root, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const md = fs.readFileSync(skillFile, "utf8");
    out.push({ slug: entry.name, md });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// Install the slim engine skill set to every global ~/.../skills/ dir
// (Claude Code, Cursor, Codex, Antigravity/skills.sh). External engines only
// need to know how to talk TO apx — not the full APX sub-skill catalog. The
// rich bundled set in skills/<slug>/ stays in-repo for the APX super-agent.
//
// The set lives at skills/engines/<slug>/SKILL.md and is currently:
//   apx, apx-mcp, apc-context.
//
// `includeOptional` / `includeInternal` are kept as no-op flags for backward
// compatibility with `apx skills sync --include-…`; the slim set has no tiers.
//
// Pruning: removes stale APX-shipped slugs that are no longer in the engine
// set (the catalog of slugs APX has ever published, see PRUNE_LEGACY_SLUGS).
// Skills the user installed themselves are NOT touched.
//
// Returns an array of { dir, skill, file, status, scope }.
//   status ∈ {created, updated, unchanged, pruned}
const PRUNE_LEGACY_SLUGS = [
  "apx-agency-agents",
  "apx-agent",
  "apx-mcp-builder",
  "apx-project",
  "apx-routine",
  "apx-runtime",
  "apx-sessions",
  "apx-skill-builder",
  "apx-task",
  "apx-telegram",
  "apx-voice",
  // Runtime CLI docs that previously leaked into global dirs — these are
  // loaded in-process by the daemon and should NOT live on disk in IDE skill
  // dirs.
  "claude-code",
  "codex-cli",
  "opencode-cli",
  "openrouter",
];

export function installGlobalSkills({
  prune = true,
  // No-ops kept for CLI backward compatibility (the slim engine set has no tiers).
  includeOptional: _includeOptional = false,
  includeInternal: _includeInternal = false,
} = {}) {
  const wanted = discoverBundledSkills();
  const wantedSlugs = new Set(wanted.map((s) => s.slug));

  const results = [];
  for (const base of GLOBAL_SKILL_DIRS) {
    for (const { slug, md } of wanted) {
      const dest = path.join(base, slug, "SKILL.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const existed = fs.existsSync(dest);
      const previous = existed ? fs.readFileSync(dest, "utf8") : null;
      if (previous === md) {
        results.push({ dir: base, skill: slug, file: dest, status: "unchanged", scope: "engine" });
        continue;
      }
      fs.writeFileSync(dest, md, "utf8");
      results.push({ dir: base, skill: slug, file: dest, status: existed ? "updated" : "created", scope: "engine" });
    }
    if (prune) {
      for (const slug of PRUNE_LEGACY_SLUGS) {
        if (wantedSlugs.has(slug)) continue;
        const dest = path.join(base, slug, "SKILL.md");
        if (!fs.existsSync(dest)) continue;
        fs.unlinkSync(dest);
        try { fs.rmdirSync(path.dirname(dest)); } catch {}
        results.push({ dir: base, skill: slug, file: dest, status: "pruned", scope: "legacy" });
      }
    }
  }
  return results;
}


// Generic starter written ONCE at `apx init`. AGENTS.md is the project's
// startup-rules file — read by Claude, Codex, APX and other AGENTS.md-aware
// tools when they begin working here. It is NOT an agent registry (APX agents
// live in `.apc/agents/<slug>.md`). After init it belongs to the user; APX
// never rewrites it.
const AGENTS_MD_TEMPLATE = `# AGENTS.md

> Startup rules and conventions for AI agents working in this project.
> Read by Claude, Codex, APX and other AGENTS.md-aware tools. Edit freely —
> this file is yours; APX won't overwrite it.

## Overview

<!-- What is this project? Tech stack, entry points, how to run it. -->

## Conventions

<!-- Code style, structure, naming, testing — how to write code that fits. -->

## Rules

<!-- Hard constraints: what agents must always / never do here. -->
`;

const APC_GITIGNORE = `# APC repository-safe context only.
# Runtime state belongs in ~/.apx/projects/<id>/, not in .apc/.

# Legacy per-agent runtime dirs (agent definitions are flat: agents/<slug>.md)
agents/*/

# Runtime sessions / conversations / messages
sessions/
conversations/
messages/
chats/
threads/
transcripts/
runs/

# Runtime memory, indexes, databases, and caches
memory.local.md
auto-memory.md
cache/
tmp/
private/
secrets/
*.db
*.db-*
*.sqlite
*.sqlite3
project.db
memory.db
memory-index.jsonl
memory-cursor.json

# Local config and secrets
.env
*.local.json
*.secret.json
*.env
*.env.*
*.key
*.pem
*.p12
*.crt
credentials.json
service-account*.json
token*.json
mcps.local.json
config.local.json

# Scratch planning state
plans/scratch/
plans/*.local.md

# Migration marker and OS noise
migrate.md
.DS_Store
`;


// Files that carry project context but are IDE-specific — candidates for APC migration.
const SCATTERED_CONTEXT_FILES = [
  { file: "CLAUDE.md",                         label: "Claude Code instructions" },
  { file: ".cursorrules",                      label: "Cursor rules" },
  { file: ".windsurfrules",                    label: "Windsurf rules" },
  { file: ".clinerules",                       label: "Cline rules" },
  { file: ".github/copilot-instructions.md",   label: "GitHub Copilot instructions" },
  { file: ".trae/rules/project_rules.md",      label: "Trae rules" },
];

// Returns files found in `root` that look like scattered context.
export function detectScatteredContext(root) {
  return SCATTERED_CONTEXT_FILES.filter(({ file }) =>
    fs.existsSync(path.join(root, file))
  );
}

// Writes .apc/migrate.md so the next agent session opens with a migration offer.
function writeMigrateMd(apfDir, found) {
  const lines = [
    "# APC Migration Pending",
    "",
    "This file was created by `apx init`. It signals to agents that this project",
    "has existing context files that have not yet been migrated to `.apc/`.",
    "",
    "**Delete this file** once migration is complete.",
    "",
    "## Detected files",
    "",
    ...found.map(({ file, label }) => `- \`${file}\` — ${label}`),
  ];
  fs.writeFileSync(path.join(apfDir, "migrate.md"), lines.join("\n") + "\n");
}

// Get the stable APX storage ID for a project, generating one if it doesn't exist.
// Called by the daemon when registering a project.
export function getOrCreateApxId(root) {
  const p = apcProjectFile(root);
  if (!fs.existsSync(p)) return null;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
  if (cfg.apx_id) return cfg.apx_id;
  const apxId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  console.log(`[apx] Generating new stable ID ${apxId} for project at ${root}`);
  cfg.apx_id = apxId;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  return apxId;
}

export function initApf(directory, { name } = {}) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });

  const apfDir = apcDir(root);
  fs.mkdirSync(path.join(apfDir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(apfDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(apfDir, "commands"), { recursive: true });

  const projectJson = path.join(apfDir, "project.json");
  if (!fs.existsSync(projectJson)) {
    const apxId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    fs.writeFileSync(
      projectJson,
      JSON.stringify(
        {
          name: name || path.basename(root),
          version: "0.1.0",
          apf: SPEC_VERSION,
          created: nowIso(),
          apx: null,
          apx_id: apxId,
        },
        null,
        2
      ) + "\n"
    );
  }

  const gitignore = path.join(apfDir, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, APC_GITIGNORE);
  }

  const agentsMd = agentsMdFile(root);
  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, AGENTS_MD_TEMPLATE);
  }

  // Detect scattered context files and flag for agent-driven migration.
  const scattered = detectScatteredContext(root);
  const migrateMd = path.join(apfDir, "migrate.md");
  if (scattered.length > 0 && !fs.existsSync(migrateMd)) {
    writeMigrateMd(apfDir, scattered);
  }

  return { root, agentsMd, projectJson, pendingMigration: scattered };
}

export function ensureAgentDir(root, slug) {
  fs.mkdirSync(apcAgentsDir(root), { recursive: true });
  return apcAgentsDir(root);
}

// Write .apc/agents/<slug>.md — the canonical agent definition file.
export function writeAgentFile(root, slug, fields, body = "") {
  const dest = apcAgentFile(root, slug);
  const lines = ["---"];
  const order = ["role", "model", "language", "description", "skills", "tools"];
  const written = new Set();
  for (const key of order) {
    const titleKey = key.charAt(0).toUpperCase() + key.slice(1);
    const v = fields[titleKey] ?? fields[key];
    if (v === undefined || v === null || v === "") continue;
    const value = Array.isArray(v) ? v.join(", ") : v;
    lines.push(`${key}: ${value}`);
    written.add(titleKey);
  }
  // Any extra fields not in the ordered list
  for (const [k, v] of Object.entries(fields)) {
    const titleKey = k.charAt(0).toUpperCase() + k.slice(1);
    if (written.has(titleKey) || v === undefined || v === null || v === "") continue;
    const value = Array.isArray(v) ? v.join(", ") : v;
    lines.push(`${k.toLowerCase()}: ${value}`);
  }
  lines.push("---");
  if (body) lines.push("", body);
  fs.writeFileSync(dest, lines.join("\n") + "\n");
}

// Write a vault agent template to ~/.apx/agents/<slug>.md
export function writeVaultAgentFile(slug, fields, body = "") {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  const dest = path.join(VAULT_DIR, `${slug}.md`);
  const lines = ["---"];
  const order = ["role", "model", "language", "description", "skills", "tools"];
  const written = new Set();
  for (const key of order) {
    const titleKey = key.charAt(0).toUpperCase() + key.slice(1);
    const v = fields[titleKey] ?? fields[key];
    if (v === undefined || v === null || v === "") continue;
    lines.push(`${key}: ${Array.isArray(v) ? v.join(", ") : v}`);
    written.add(titleKey);
  }
  for (const [k, v] of Object.entries(fields)) {
    const titleKey = k.charAt(0).toUpperCase() + k.slice(1);
    if (written.has(titleKey) || v === undefined || v === null || v === "") continue;
    lines.push(`${k.toLowerCase()}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  lines.push("---");
  if (body) lines.push("", body);
  fs.writeFileSync(dest, lines.join("\n") + "\n");
  // Writing always clears a tombstone — the user is explicitly putting this
  // slug back, even if it was previously removed.
  const tombs = readVaultTombstones();
  if (tombs.delete(slug)) writeVaultTombstones(tombs);
}

// Remove a vault agent. If the slug has a user-layer file we delete it; if
// the slug ALSO exists in the bundle (or the user file didn't exist but the
// bundled one does), we add a tombstone so it stays hidden. Returns one of:
//   { removed: "user" }      — user file deleted, bundled NOT present
//   { removed: "user+tomb" } — user file deleted AND bundled hidden by tombstone
//   { removed: "tomb" }      — bundled-only slug, hidden by tombstone
//   { removed: null }        — slug not found anywhere
export function removeVaultAgent(slug) {
  const userPath = path.join(VAULT_DIR, `${slug}.md`);
  const bundledPath = path.join(BUNDLED_VAULT_DIR, `${slug}.md`);
  const hadUser = fs.existsSync(userPath);
  const hasBundled = fs.existsSync(bundledPath);
  if (!hadUser && !hasBundled) return { removed: null };
  if (hadUser) fs.rmSync(userPath);
  if (hasBundled) {
    const tombs = readVaultTombstones();
    tombs.add(slug);
    writeVaultTombstones(tombs);
  }
  return {
    removed: hadUser && hasBundled ? "user+tomb" : hadUser ? "user" : "tomb",
  };
}

// Un-tombstone a bundled slug so it becomes visible again. Returns whether a
// tombstone existed before. No-op if there was nothing to restore.
export function restoreVaultAgent(slug) {
  const tombs = readVaultTombstones();
  if (!tombs.has(slug)) return { restored: false };
  tombs.delete(slug);
  writeVaultTombstones(tombs);
  return { restored: true };
}

// Add a slug to the project's agents.imported list in project.json
export function addImportedAgent(root, slug) {
  const p = apcProjectFile(root);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  if (!cfg.agents) cfg.agents = {};
  if (!cfg.agents.imported) cfg.agents.imported = [];
  if (!cfg.agents.imported.includes(slug)) cfg.agents.imported.push(slug);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// NOTE: AGENTS.md is created once at `apx init` (see AGENTS_MD_TEMPLATE) and is
// thereafter owned by the user — APX never regenerates it. Agents live in
// `.apc/agents/<slug>.md` (read by parser.js readAgents); they are NOT listed
// in AGENTS.md. The project's AGENTS.md is loaded INTO the super-agent prompt
// by buildSuperAgentSystem() in src/core/agent/prompt-builder.js.
