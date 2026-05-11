import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readAgents, readAgentsFromDir, VAULT_DIR } from "./parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const BUNDLED_SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");
const RUNTIME_SKILLS_DIR = path.join(__dirname, "runtime-skills");

export const SPEC_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Bundled skills — single source of truth lives at <packageRoot>/skills/<slug>/SKILL.md
// with proper frontmatter. The `apc-context` copy is refreshed on every
// install/update from the canonical APC repo (see src/cli/postinstall.js).
// ---------------------------------------------------------------------------

function readBundledSkill(slug) {
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

function readRuntimeSkillFiles() {
  if (!fs.existsSync(RUNTIME_SKILLS_DIR)) return [];
  return fs.readdirSync(RUNTIME_SKILLS_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      slug: path.basename(name, ".md"),
      md: fs.readFileSync(path.join(RUNTIME_SKILLS_DIR, name), "utf8").trim(),
    }));
}

// Install APX + APC context skills into IDE rule files. Returns an array of result objects.
// targetIds: array of target ids to install; null = all project targets.
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

// Install bundled APX/APC skills + runtime docs to global ~/.../skills/ dirs.
// Returns an array of result objects with { dir, skill, status }.
export function installGlobalSkills() {
  const results = [];

  const skills = [];
  const apxRaw = readBundledSkill("apx");
  const apcRaw = readBundledSkill("apc-context");
  if (apxRaw) skills.push({ slug: "apx", md: apxRaw });
  if (apcRaw) skills.push({ slug: "apc-context", md: apcRaw });
  skills.push(...readRuntimeSkillFiles());

  for (const base of GLOBAL_SKILL_DIRS) {
    for (const { slug, md } of skills) {
      const dest = path.join(base, slug, "SKILL.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const existed = fs.existsSync(dest);
      fs.writeFileSync(dest, md, "utf8");
      results.push({ dir: base, skill: slug, file: dest, status: existed ? "updated" : "created" });
    }
  }
  return results;
}


const AGENTS_MD_TEMPLATE = `# Agents

> This file is the contract for agents in this project.
> It follows the APC spec (https://github.com/agentprojectcontext/agentprojectcontext).

<!-- Add an agent like this:

## sofia
- **Role**: Support
- **Model**: claude-haiku-4-5
- **Skills**: customer-support
- **Language**: es-AR

-->
`;

const APC_GITIGNORE = `# APC runtime data — never in the repository
# Chat conversations and runtime sessions belong in ~/.apx/projects/<id>/
agents/*/sessions/
agents/*/conversations/
sessions/
conversations/
messages/
chats/
cache/
tmp/
private/
secrets/
*.local.json
*.secret.json
*.env
*.env.*
project.db
migrate.md
`;

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

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
  const p = path.join(root, ".apc", "project.json");
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

  const apfDir = path.join(root, ".apc");
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

  const agentsMd = path.join(root, "AGENTS.md");
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
  const dir = path.join(root, ".apc", "agents", slug);
  fs.mkdirSync(dir, { recursive: true });
  const memory = path.join(dir, "memory.md");
  if (!fs.existsSync(memory)) {
    fs.writeFileSync(
      memory,
      `# Memory — ${slug}\n\n` +
        `## Identity\n- \n\n` +
        `## Long-term facts\n- \n\n` +
        `## Recent context\n- \n`
    );
  }
  return dir;
}

// Write .apc/agents/<slug>.md — the canonical agent definition file.
export function writeAgentFile(root, slug, fields, body = "") {
  const dest = path.join(root, ".apc", "agents", `${slug}.md`);
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
}

// Add a slug to the project's agents.imported list in project.json
export function addImportedAgent(root, slug) {
  const p = path.join(root, ".apc", "project.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  if (!cfg.agents) cfg.agents = {};
  if (!cfg.agents.imported) cfg.agents.imported = [];
  if (!cfg.agents.imported.includes(slug)) cfg.agents.imported.push(slug);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// Regenerate AGENTS.md from .apc/agents/*.md for Codex/Antigravity compat.
export function regenerateAgentsMd(root) {
  const agents = readAgents(root);
  const header = [
    "# Agents",
    "",
    "> Auto-generated from .apc/agents/*.md — edit individual agent files, not this file.",
    "> Read by Codex, Antigravity, and other tools that follow the AGENTS.md convention.",
    "",
  ].join("\n");

  if (agents.length === 0) {
    fs.writeFileSync(path.join(root, "AGENTS.md"), header);
    return;
  }

  const blocks = agents.map((a) => {
    const tag = a.source === "vault" ? "  <!-- vault -->" : "";
    return renderAgentBlock(a.slug, a.fields) + tag;
  });
  fs.writeFileSync(path.join(root, "AGENTS.md"), header + blocks.join("\n\n") + "\n");
}

export function appendAgentToAgentsMd(root, slug, fields) {
  const agentsMdPath = path.join(root, "AGENTS.md");
  let text = fs.existsSync(agentsMdPath)
    ? fs.readFileSync(agentsMdPath, "utf8")
    : AGENTS_MD_TEMPLATE;

  if (!/^#\s+Agents\s*$/im.test(text)) {
    text = `# Agents\n\n${text}`;
  }

  const block = renderAgentBlock(slug, fields);

  if (!text.endsWith("\n")) text += "\n";
  text += `\n${block}\n`;
  fs.writeFileSync(agentsMdPath, text);
}

export function renderAgentBlock(slug, fields) {
  const lines = [`## ${slug}`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    const value = Array.isArray(v) ? v.join(", ") : v;
    lines.push(`- **${k}**: ${value}`);
  }
  return lines.join("\n");
}
