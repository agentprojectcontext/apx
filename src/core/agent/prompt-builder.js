// Prompt builder for the APX default agent — known internally as the
// "super-agent". That name is a MODE descriptor (the daemon-level tool-using
// loop that runs when no project agent is named), not a persona the user
// should ever see. The model is told its real display name comes from
// ~/.apx/identity.json; "super-agent" only appears in code, file paths, CLI
// flags, and channel meta.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readIdentity } from "../identity.js";
import { readSelfMemoryForPrompt } from "./self-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");
const BASE_PROMPT_PATH = path.join(PROMPTS_DIR, "super-agent-base.md");

const promptCache = new Map();

/** @deprecated use super-agent-base.md */
const LEGACY_PROMPT_PATH = path.join(PROMPTS_DIR, "super-agent-default.md");

const CHANNEL_PROMPT_FILES = {
  telegram: "channels/telegram.md",
  terminal: "channels/terminal.md",
  cli: "channels/cli.md",
  overlay: "channels/overlay.md",
  routine: "channels/routine.md",
  api: "channels/api.md",
  voice: "channels/voice.md",
  deck: "channels/deck.md",
};

export function loadPrompt(relativePath) {
  const key = relativePath.replace(/\\/g, "/");
  if (promptCache.has(key)) return promptCache.get(key);
  const full = path.join(PROMPTS_DIR, key);
  const text = fs.readFileSync(full, "utf8");
  promptCache.set(key, text);
  return text;
}

export function loadDefaultSystemPrompt() {
  if (fs.existsSync(BASE_PROMPT_PATH)) return loadPrompt("super-agent-base.md");
  if (fs.existsSync(LEGACY_PROMPT_PATH)) return loadPrompt("super-agent-default.md");
  throw new Error("super-agent base prompt not found");
}

/** @deprecated use loadDefaultSystemPrompt — kept for tests/imports */
export const DEFAULT_SYSTEM = loadDefaultSystemPrompt();

export function renderPromptTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null || value === "" ? "" : String(value);
  });
}

export function buildChannelContextBlock(channel, meta = {}) {
  const rel = CHANNEL_PROMPT_FILES[String(channel || "").toLowerCase()];
  if (!rel) return "";
  return renderPromptTemplate(loadPrompt(rel), meta);
}

export function buildUserContextBlock(identity, globalConfig = {}) {
  const user = globalConfig?.user || {};
  const lang = user.language || identity?.language || "en";
  const lines = ["# User & identity"];

  const agentName = identity?.agent_name || globalConfig?.super_agent?.name;
  if (agentName) lines.push(`Your name is ${agentName}.`);
  if (identity?.personality) lines.push(`Your personality: ${identity.personality}.`);
  if (identity?.owner_name) lines.push(`Your owner is ${identity.owner_name}.`);
  if (identity?.owner_context) lines.push(`Owner context: ${identity.owner_context}`);

  lines.push(
    `Reply in the language with ISO 639-1 code "${lang}" unless the user explicitly switches language for that turn.`
  );
  if (user.locale) {
    lines.push(`Preferred locale or dialect: ${user.locale}.`);
  }
  if (user.timezone) {
    lines.push(
      `User timezone: ${user.timezone}. Use it for local time and schedules unless the user specifies otherwise.`
    );
  }

  return lines.join("\n");
}

/** Back-compat wrapper — second arg is ISO language only (no full config). */
export function buildIdentityBlock(identity, userLang = "en") {
  return buildUserContextBlock(identity, { user: { language: userLang } });
}

// "Who you're talking to" block. Agent-agnostic: built once from the resolved
// sender (see core/telegram-identity.js) and injected into BOTH the super-agent
// prompt and any routed project-agent prompt, so identification doesn't depend
// on which agent answers. Returns "" when there's no sender info.
export function buildRelationshipBlock(sender) {
  if (!sender || sender.userId == null) return "";
  const handle = sender.username ? ` (@${sender.username})` : "";
  const lines = ["# Who you're talking to"];

  if (sender.isGroup) {
    lines.push(
      "This is a Telegram GROUP chat with multiple people — do NOT assume a single owner."
    );
    lines.push(
      `Sender of this message: ${sender.name}${handle}, role: ${sender.role}.`
    );
  } else if (sender.isOwner) {
    lines.push(
      `You are talking to your owner, ${sender.name}. Treat them as the owner — ` +
        "never ask their name or who they are; you already know them."
    );
  } else if (sender.role && sender.role !== "guest") {
    lines.push(`You are talking to ${sender.name}${handle}, role: ${sender.role}.`);
  } else {
    lines.push(
      `You are talking to ${sender.name}${handle}, who is NOT a recognized contact ` +
        "(role: guest, no permissions)."
    );
    lines.push(
      "Politely say you don't know them yet and ask who they are; tell them you'll " +
        "note it down, but that you cannot grant any role or permissions yourself — " +
        "only the owner or someone via terminal/web can assign a role. Do not perform " +
        "privileged or destructive actions on their behalf."
    );
  }
  if (sender.note) lines.push(`Notes on this contact: ${sender.note}`);
  return lines.join("\n");
}

// Roby's own notebook (~/.apx/memory.md), bounded for the prompt. Returns ""
// when empty so the block is dropped entirely.
export function buildSelfMemoryBlock() {
  const slice = readSelfMemoryForPrompt();
  if (!slice) return "";
  return [
    "# Your notebook (self-memory)",
    "Durable things you chose to remember across sessions. Treat as known facts;",
    "update with the `remember` tool. Call read_self_memory if this looks truncated.",
    "",
    slice,
  ].join("\n");
}

export function isSuperAgentEnabled(cfg) {
  const sa = cfg && cfg.super_agent;
  if (!sa || !sa.model) return false;
  return sa.enabled !== false;
}

function buildPermissionBlock(sa) {
  const permissionMode = sa.permission_mode || "automatico";
  const allowedTools = Array.isArray(sa.allowed_tools) ? sa.allowed_tools : [];
  return [
    "# Permission mode",
    `mode: ${permissionMode}`,
    `allowed_tools: ${allowedTools.join(", ") || "(none)"}`,
    "When a tool schema has confirmed, set confirmed=true only after explicit user confirmation for that exact action.",
  ].join("\n");
}

function buildSkillsCatalog(listSkills) {
  let list = [];
  try {
    list = listSkills();
  } catch {
    /* empty */
  }
  if (!list.length) return "";
  return [
    "# Available skills (load on demand)",
    "Below is the catalog of skills (slug + description). Bodies are NOT loaded yet.",
    "If the user asks how something works, requests syntax/docs, or otherwise needs",
    "knowledge that matches a skill description (in any language — match semantically),",
    "call load_skill({slug}) to load the full markdown into your context.",
    "",
    ...list.map((s) => `- **${s.slug}** [${s.source}]: ${s.description || "(no description)"}`),
  ].join("\n");
}

export function buildSuperAgentSystem({
  globalConfig,
  projects,
  listSkills,
  contextNote = "",
  channel = "",
  channelMeta = {},
  // Pre-rendered "who you're talking to" block (see buildRelationshipBlock).
  // Injected right after the user/identity block so the model knows the
  // sender's identity and role before anything else.
  relationshipBlock = "",
  // Channel-specific addendum the super-agent caller can inject —
  // e.g. voice.js asks for a trailing ```suggestions``` JSON block on
  // voice/deck surfaces. Kept separate from contextNote so it lives
  // at the end of the system prompt (where format directives belong),
  // not mixed in with situational context.
  systemSuffix = "",
}) {
  const sa = globalConfig.super_agent;
  const projectIndex = projects
    .list()
    .map((p) => `  ${p.id}: ${p.id === 0 ? "[default]" : "[project]"} "${p.name}" (${p.path})`)
    .join("\n");

  const identity = (() => {
    try {
      return readIdentity();
    } catch {
      return null;
    }
  })();

  const channelBlock = buildChannelContextBlock(channel, channelMeta);
  const extraContext = [channelBlock, contextNote].filter(Boolean).join("\n\n");

  return [
    sa.system || loadDefaultSystemPrompt(),
    buildUserContextBlock(identity, globalConfig),
    buildSelfMemoryBlock(),
    relationshipBlock,
    buildPermissionBlock(sa),
    extraContext,
    "# Registered projects (just the index — call tools for details)",
    projectIndex || "(no projects registered)",
    buildSkillsCatalog(listSkills),
    systemSuffix,
  ]
    .filter(Boolean)
    .join("\n\n");
}
