import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { readAgents, readAgentsFromDir } from "./parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SPEC_VERSION = "0.1.0";

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
    render: (c) => buildSkillMd(c),
    append: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    ideDir: ".cursor",
    file: ".cursor/rules/apx.mdc",
    render: (c) =>
      `---\ndescription: APX Agent Project Framework. Use when the project has AGENTS.md or .apc/ — provides apx run, apx exec, apx memory, apx mcp, apx messages, apx session commands.\n---\n\n${c}`,
    append: false,
  },
  {
    id: "windsurf",
    label: "Windsurf",
    ideDir: ".windsurf",
    file: ".windsurf/rules/apx.md",
    render: (c) =>
      `---\ntrigger: model_decision\ndescription: APX Agent Project Framework. Use when the project has AGENTS.md or .apc/ — provides apx run, apx exec, apx memory, apx mcp, apx messages, apx session commands.\n---\n\n${c}`,
    append: false,
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    ideDir: ".github",
    file: ".github/copilot-instructions.md",
    render: (c) => `\n<!-- apx-skill -->\n${c}\n<!-- /apx-skill -->\n`,
    append: true,
    guard: "<!-- apx-skill -->",
  },
  {
    id: "trae",
    label: "Trae",
    ideDir: ".trae",
    file: ".trae/rules/project_rules.md",
    render: (c) => `\n<!-- apx-skill -->\n${c}\n<!-- /apx-skill -->\n`,
    append: true,
    guard: "<!-- apx-skill -->",
  },
];

// Global targets (absolute paths, use ~/<dir>/skills/apx/SKILL.md format).
// These dirs are read by Claude Code, Cursor (compat), and tools adopting the skills.sh spec.
const GLOBAL_SKILL_DIRS = [
  path.join(os.homedir(), ".claude", "skills"),    // Claude Code + Cursor legacy compat
  path.join(os.homedir(), ".cursor", "skills"),    // Cursor primary global path
  path.join(os.homedir(), ".codex",  "skills"),    // Codex (OpenAI)
  path.join(os.homedir(), ".agents", "skills"),    // Antigravity/other skills.sh adopters
];

function buildSkillMd(content) {
  const frontmatter = [
    "---",
    "name: apx",
    "description: APX (Agent Project Framework) skill. Use when the project has AGENTS.md or .apc/. Provides: multi-agent coordination (apx run, apx exec), memory (apx memory), MCP access (apx mcp), sessions (apx session), message history (apx messages tail). Activate on: run an agent, coordinate agents, apx, APC project, check agent memory, list MCPs.",
    "homepage: https://github.com/apc-spec/apf",
    "---",
    "",
  ].join("\n");
  return frontmatter + content;
}

// Install the APX skill into IDE rule files. Returns an array of result objects.
// targetIds: array of target ids to install; null = all project targets.
export function installIdeSkills(root, targetIds = null) {
  const skillSource = path.join(__dirname, "apx-skill.md");
  if (!fs.existsSync(skillSource)) return [];

  const content = fs.readFileSync(skillSource, "utf8").trim();
  const targets = targetIds
    ? IDE_TARGETS.filter((t) => targetIds.includes(t.id))
    : IDE_TARGETS;

  const results = [];
  for (const t of targets) {
    // Skip if the IDE hasn't been set up in this project yet.
    if (t.ideDir && !fs.existsSync(path.join(root, t.ideDir))) {
      results.push({ ...t, status: "skipped (IDE not present)" });
      continue;
    }
    const dest = path.join(root, t.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const rendered = t.render(content);

    if (t.append) {
      const existing = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
      if (t.guard && existing.includes(t.guard)) {
        results.push({ ...t, status: "already installed" });
        continue;
      }
      fs.appendFileSync(dest, rendered, "utf8");
      results.push({ ...t, status: "appended" });
    } else {
      const existed = fs.existsSync(dest);
      fs.writeFileSync(dest, rendered, "utf8");
      results.push({ ...t, status: existed ? "updated" : "created" });
    }
  }
  return results;
}

// Install APX skill to global ~/.claude/skills/, ~/.cursor/skills/, ~/.agents/skills/.
// Returns an array of result objects with { dir, status }.
export function installGlobalSkills() {
  const skillSource = path.join(__dirname, "apx-skill.md");
  if (!fs.existsSync(skillSource)) return [];

  const content = fs.readFileSync(skillSource, "utf8").trim();
  const skillMd = buildSkillMd(content);
  const results = [];

  for (const base of GLOBAL_SKILL_DIRS) {
    const dest = path.join(base, "apx", "SKILL.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const existed = fs.existsSync(dest);
    fs.writeFileSync(dest, skillMd, "utf8");
    results.push({ dir: base, file: dest, status: existed ? "updated" : "created" });
  }
  return results;
}

const AGENTS_MD_TEMPLATE = `# Agents

> This file is the contract for agents in this project.
> It follows the APC spec (https://github.com/apc-spec/apf).

<!-- Add an agent like this:

## sofia
- **Role**: Support
- **Model**: claude-haiku-4-5
- **Skills**: customer-support
- **Language**: es-AR

-->
`;

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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
    fs.writeFileSync(
      projectJson,
      JSON.stringify(
        {
          name: name || path.basename(root),
          version: "0.1.0",
          apf: SPEC_VERSION,
          created: nowIso(),
        },
        null,
        2
      ) + "\n"
    );
  }

  const agentsMd = path.join(root, "AGENTS.md");
  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, AGENTS_MD_TEMPLATE);
  }

  // Write the APX base skill so all runtimes start with it automatically.
  const apxSkill = path.join(apfDir, "skills", "apx.md");
  if (!fs.existsSync(apxSkill)) {
    const src = path.join(__dirname, "apx-skill.md");
    if (fs.existsSync(src)) fs.copyFileSync(src, apxSkill);
  }

  return { root, agentsMd, projectJson };
}

export function ensureAgentDir(root, slug) {
  const dir = path.join(root, ".apc", "agents", slug);
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
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

// Regenerate AGENTS.md from .apc/agents/*.md for Codex/Antigravity compat.
export function regenerateAgentsMd(root) {
  // readAgents merges file-based agents + any legacy AGENTS.md entries not yet migrated.
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

  const blocks = agents.map((a) => renderAgentBlock(a.slug, a.fields));
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
