import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAgentMemory } from "./memory.js";
import { apcProjectFile, apcSkillFile } from "../apc/paths.js";

// Anti-ghost-response rules injected into every agent system prompt. The text
// lives next to the agent prompts (src/core/agent/prompts/action-discipline.md)
// so it can be edited without touching code. Cached at module load.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION_DISCIPLINE_RULES = fs
  .readFileSync(path.join(__dirname, "prompts", "action-discipline.md"), "utf8")
  .trimEnd();

function listField(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function projectName(project) {
  if (project?.name) return project.name;
  try {
    const meta = JSON.parse(fs.readFileSync(apcProjectFile(project.path), "utf8"));
    return meta.name || path.basename(project.path);
  } catch {
    return path.basename(project?.path || "");
  }
}

export function agentSkills(agent) {
  return listField(agent?.fields?.Skills);
}

export function buildAgentSystem(project, agent, {
  invocation = "engine",
  runtime = null,
  channel = null,
  caller = null,
  routine = null,
  extraParts = [],
} = {}) {
  const fields = agent.fields || {};
  const parts = [
    `You are APC agent "${agent.slug}".`,
    `Project: ${projectName(project)} (${project.path}).`,
  ];

  if (fields.Description) parts.push(String(fields.Description));
  if (fields.Role) parts.push(`Role: ${fields.Role}`);
  if (fields.Language) parts.push(`Default language: ${fields.Language}`);

  const declaredTools = listField(fields.Tools);
  if (declaredTools.length) {
    parts.push(
      [
        "## Declared Tool Hints",
        declaredTools.join(", "),
        "These are agent-level tool expectations, not a guarantee. Actual callable tools depend on invocation surface.",
      ].join("\n")
    );
  }

  parts.push(buildInvocationContext({ invocation, runtime, channel, caller, routine }));

  const memory = readAgentMemory(project, agent.slug);
  if (memory) parts.push("## Memory\n" + memory);

  const apxSkill = apcSkillFile(project.path, "apx");
  if (fs.existsSync(apxSkill)) parts.push("## APX\n" + fs.readFileSync(apxSkill, "utf8"));

  for (const skill of agentSkills(agent)) {
    const skillPath = apcSkillFile(project.path, skill);
    if (fs.existsSync(skillPath)) parts.push(`## Skill: ${skill}\n` + fs.readFileSync(skillPath, "utf8"));
  }

  for (const ep of extraParts) {
    if (ep) parts.push(ep);
  }

  // Always append action discipline rules last so they are close to the end
  // of the system prompt and harder for the model to "forget".
  parts.push(ACTION_DISCIPLINE_RULES);

  return parts.join("\n\n");
}

function buildInvocationContext({ invocation, runtime, channel, caller, routine }) {
  const lines = [
    "## Invocation Context",
    `invocation: ${invocation}`,
  ];
  if (runtime) lines.push(`runtime: ${runtime}`);
  if (channel) lines.push(`channel: ${channel}`);
  if (caller) lines.push(`caller: ${caller}`);
  if (routine) lines.push(`routine: ${routine}`);

  if (runtime) {
    lines.push(
      "You are running inside the named external runtime. Use only tools and permissions that runtime actually exposes."
    );
  } else if (invocation === "engine") {
    lines.push("You are a direct LLM call through APX. Do not claim shell, file, MCP, or Telegram tools unless APX explicitly provided them.");
  } else if (invocation === "telegram") {
    lines.push("You are replying through Telegram. Keep responses brief, plain text, and matched to the user's language.");
  } else if (invocation === "routine") {
    lines.push("You were invoked by an APX routine. Complete the requested work now; do not say you will do it later.");
  }

  return lines.join("\n");
}
