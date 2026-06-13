// System prompt for project agents (Cody, Sofía, etc.). Shares the agent-base
// + action discipline with the super-agent, layered with a project-agent role
// delta plus the agent's own profile fields.
//
// When a project agent answers through a real user channel (Telegram, web,
// desktop), pass `channel` / `channelMeta` / `sender` so the channel-context,
// relationship and voice-mode / segmenting blocks come along — without that
// the agent has no idea HOW the user is talking to it.
import fs from "node:fs";
import { readAgentMemory } from "./memory.js";
import { apcProjectFile, apcSkillFile } from "../apc/paths.js";
import {
  PROMPTS,
  buildChannelContextBlock,
  buildVoiceModeBlock,
  buildRelationshipBlock,
  buildUserContextBlock,
  buildSegmentDiscipline,
} from "./prompt-builder.js";

// Cap the injected agent body so an over-long authored file can't blow the
// token budget. Mirrors PROJECT_AGENTS_MAX_CHARS for AGENTS.md.
const AGENT_BODY_MAX_CHARS = 6000;

function listField(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function projectName(project) {
  if (project?.name) return project.name;
  try {
    const meta = JSON.parse(fs.readFileSync(apcProjectFile(project.path), "utf8"));
    return meta.name || project.path?.split("/").pop() || "";
  } catch {
    return project?.path?.split("/").pop() || "";
  }
}

export function agentSkills(agent) {
  return listField(agent?.fields?.Skills);
}

/**
 * Build the system prompt for a project agent.
 *
 * @param project        { id, name, path, ... }
 * @param agent          { slug, fields: { Description, Role, Language, Skills, Tools, ... }, body }
 * @param opts
 * @param opts.invocation  "engine" (direct LLM call), "telegram", "routine", etc.
 * @param opts.runtime     external runtime name when relevant ("claude-code", …)
 * @param opts.channel     surface the user is on (channels/<name>.md is layered in)
 * @param opts.channelMeta meta for the channel template + `{voice: true}` flag
 * @param opts.sender      resolved sender for the relationship block
 * @param opts.caller      who invoked us (another agent slug, "user", "routine", …)
 * @param opts.routine     routine name when invocation === "routine"
 * @param opts.globalConfig used for user.language / user.locale / user.timezone
 * @param opts.extraParts  additional blocks to append before discipline
 */
export function buildAgentSystem(project, agent, {
  invocation = "engine",
  runtime = null,
  channel = null,
  channelMeta = {},
  sender = null,
  caller = null,
  routine = null,
  globalConfig = {},
  extraParts = [],
} = {}) {
  const fields = agent.fields || {};
  const channelLow = String(channel || "").toLowerCase();
  const voice = !!channelMeta?.voice || channelLow === "voice";

  // Shared base + project-agent role delta (the "I'm scoped to one project" framing).
  const roleBlock = [PROMPTS.AGENT_BASE, PROMPTS.PROJECT_AGENT_ROLE].join("\n\n");

  // Agent profile (its display name + description + Role + Language + owner from config).
  const profileLines = [
    `# Agent profile`,
    `You are **${agent.slug}**, a project agent dedicated to **${projectName(project)}** (\`${project.path}\`).`,
  ];
  if (fields.Description) profileLines.push(fields.Description);
  if (fields.Role) profileLines.push(`Role: ${fields.Role}`);
  if (fields.Language) profileLines.push(`Default language: ${fields.Language}`);

  // The agent's authored body (everything after the frontmatter in its
  // `.apc/agents/<slug>.md`) is its real instruction set — persona, domain
  // rules, API endpoints, tone, hard limits. Without injecting it the agent
  // runs on its fields alone and loses everything its author actually wrote.
  let customBody = String(agent.body || "").trim();
  if (customBody.length > AGENT_BODY_MAX_CHARS) {
    customBody = customBody.slice(0, AGENT_BODY_MAX_CHARS) + "\n\n…(instructions truncated)";
  }
  const customInstructions = customBody ? `# Custom instructions\n${customBody}` : "";

  // User context (owner name, language, timezone) — same block the super-agent
  // gets, so project agents know how to address the user.
  const userContext = buildUserContextBlock(null, globalConfig, { agentName: agent.slug });

  // Channel context — the same channels/*.md the super-agent uses. Project
  // agents talk through the same surfaces; they need the same formatting rules.
  const channelBlock = buildChannelContextBlock(channel, channelMeta);
  const voiceBlock = buildVoiceModeBlock(voice);
  const segmentDiscipline = buildSegmentDiscipline({ channel: channelLow, voice });

  // Relationship block — "you're talking to <owner>" / "<contact>" / "<guest>".
  const relationship = buildRelationshipBlock(sender);

  // Declared tool hints (informational — actual callables come from runtime).
  const declaredTools = listField(fields.Tools);
  const toolHints = declaredTools.length
    ? [
        "## Declared tool hints (agent-level expectations)",
        declaredTools.join(", "),
        "Actual callable tools depend on the invocation surface — use whatever the runtime sends this turn.",
      ].join("\n")
    : "";

  // Invocation context (who called me, through what, for what).
  const invocationCtx = buildInvocationContext({ invocation, runtime, caller, routine });

  // Per-agent memory (lives under <project>/.apc/agents/<slug>/memory.md).
  const memory = readAgentMemory(project, agent.slug);
  const memoryBlock = memory ? "# Memory\n" + memory : "";

  // Project's APX skill + agent's declared skills (loaded as full bodies — they're
  // small and specific to this agent).
  const projectSkills = buildProjectSkills(project, agent);

  return [
    roleBlock,
    profileLines.join("\n"),
    customInstructions,
    userContext,
    memoryBlock,
    relationship,
    channelBlock,
    toolHints,
    invocationCtx,
    projectSkills,
    ...extraParts.filter(Boolean),
    voiceBlock,
    PROMPTS.ACTION_DISCIPLINE,
    segmentDiscipline,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildInvocationContext({ invocation, runtime, caller, routine }) {
  const lines = [`## Invocation`, `invocation: ${invocation}`];
  if (runtime) lines.push(`runtime: ${runtime}`);
  if (caller) lines.push(`caller: ${caller}`);
  if (routine) lines.push(`routine: ${routine}`);

  if (runtime) {
    lines.push(
      "You're running inside the named external runtime. Use only tools and permissions that runtime exposes."
    );
  } else if (invocation === "routine") {
    lines.push(
      "You were invoked by an APX routine. Complete the requested work now; don't say you will do it later."
    );
  } else if (invocation === "engine") {
    lines.push(
      "You're a direct LLM call through APX. Don't claim shell, file, MCP, or Telegram tools unless the runtime explicitly sent them this turn."
    );
  }
  return lines.join("\n");
}

function buildProjectSkills(project, agent) {
  const parts = [];
  const apxSkill = apcSkillFile(project.path, "apx");
  if (fs.existsSync(apxSkill)) {
    parts.push("## APX\n" + fs.readFileSync(apxSkill, "utf8").trim());
  }
  for (const skill of agentSkills(agent)) {
    const skillPath = apcSkillFile(project.path, skill);
    if (fs.existsSync(skillPath)) {
      parts.push(`## Skill: ${skill}\n` + fs.readFileSync(skillPath, "utf8").trim());
    }
  }
  return parts.join("\n\n");
}
