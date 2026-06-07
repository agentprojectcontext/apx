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

// Channels are SURFACES (where the user is). Voice is NOT a channel — it's a
// MODE that layers on top of a surface (see buildVoiceModeBlock); a spoken deck
// turn is channel "deck" + voice mode, not its own channel.
const CHANNEL_PROMPT_FILES = {
  telegram: "channels/telegram.md",
  terminal: "channels/terminal.md",
  cli: "channels/cli.md",
  routine: "channels/routine.md",
  api: "channels/api.md",
  web: "channels/web.md",                 // web big chat (long-form, full tools)
  web_sidebar: "channels/web_sidebar.md", // web quick chat (short, lightweight)
  deck: "channels/deck.md",               // cockpit dashboard
  desktop: "channels/desktop.md",         // PC floating module (was "overlay")
  code: "channels/code.md",               // web Code module (rich coding session)
};

// Voice mode: spoken-reply rules layered on any surface when the turn will be
// read aloud by TTS (deck voice overlay, desktop module, etc). Injected with
// high recency (right before systemSuffix) so weaker models don't bury it.
const VOICE_MODE_FILE = "modes/voice.md";

export function buildVoiceModeBlock(active) {
  if (!active) return "";
  try {
    return loadPrompt(VOICE_MODE_FILE);
  } catch {
    return "";
  }
}

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

// Project startup rules. When APX runs its OWN loop inside a project, load that
// project's AGENTS.md into the prompt — the same convention Claude/Codex follow
// with CLAUDE.md/AGENTS.md. `projectPath` flows in via channelMeta.projectPath
// (set by the super-agent API, the code module, and routines). This is wired
// ONLY into the super-agent prompt: when APX delegates to an external engine,
// that engine reads AGENTS.md itself. Size-capped to protect the prompt budget.
export const PROJECT_AGENTS_MAX_CHARS = 6000;
export function buildProjectAgentsBlock(projectPath) {
  if (!projectPath) return "";
  try {
    const file = path.join(projectPath, "AGENTS.md");
    if (!fs.existsSync(file)) return "";
    let text = fs.readFileSync(file, "utf8").trim();
    if (!text) return "";
    if (text.length > PROJECT_AGENTS_MAX_CHARS) {
      text = text.slice(0, PROJECT_AGENTS_MAX_CHARS) + "\n\n…(AGENTS.md truncated)";
    }
    return `# Project guidance (AGENTS.md)\n\nStartup rules for THIS project — follow them:\n\n${text}`;
  } catch {
    return "";
  }
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

// Skill descriptions are authored for Claude Code's skill matcher, so many end
// with verbose "Trigger on: …" / "Activate when …" lists and multi-sentence
// usage notes. Inside Roby's prompt those tails are pure noise (he matches
// semantically, not by trigger string). Keep the first sentence only, drop the
// trigger/activation tail, and cap length — this is the single biggest
// signal-per-token win in the prompt (~1k tokens recovered per turn).
function condenseSkillDescription(desc) {
  if (!desc) return "(no description)";
  const full = String(desc).replace(/\s+/g, " ").trim();
  const MARKER =
    /\s*(?:Trigger(?:s)? on|Triggers|TRIGGER|Activate (?:on|when|only)|Use this skill (?:whenever|when)|Use (?:it )?when|Triggers include|SKIP|Also (?:use|triggers))\b/i;
  // Prefer the gist before any trigger/activation marker; but if a skill leads
  // straight into "Activate ONLY when…" (no gist first), that head is empty —
  // fall back to the first sentence of the full text so we keep real info.
  let d = full.split(MARKER)[0].trim();
  if (d.length < 15) d = full;
  // First sentence only, then cap length.
  const firstStop = d.search(/\.(\s|$)/);
  if (firstStop > 0) d = d.slice(0, firstStop + 1);
  d = d.trim();
  if (d.length > 160) d = d.slice(0, 157).trimEnd() + "…";
  return d || "(no description)";
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
    "Catalog (slug + one-line gist). Bodies are NOT loaded. When the user needs",
    "knowledge or syntax matching one (match semantically, any language), call",
    "load_skill({slug}).",
    "",
    ...list.map((s) => `- **${s.slug}**: ${condenseSkillDescription(s.description)}`),
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
  // Pre-rendered output of the Memory Broker (Pieza 4): a [MEMORIA RELEVANTE]
  // block built from the RAG retriever + recent memory.md entries. When
  // provided it REPLACES the always-on self-memory slice (it already includes
  // the latest notebook entries). "" falls back to the plain notebook slice.
  memoryBlock = "",
  // Pre-rendered "# Hilos activos en otros canales" block (recency-based
  // cross-channel awareness; see core/memory/active-threads.js). "" → omitted.
  activeThreadsBlock = "",
  // Compact "# Tools adicionales (activación on-demand)" block: instructions +
  // the NAMES (no schemas) of tools that exist but aren't loaded on this
  // channel, so the model knows they're reachable via discover_tools without
  // paying for their schemas. "" → omitted (full channels load everything).
  lazyToolsBlock = "",
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
  // Voice is a mode, not a channel: the caller flags a spoken turn via
  // channelMeta.voice (or the legacy channel === "voice"). The block goes last,
  // next to systemSuffix, so format directives keep recency.
  const voiceModeBlock = buildVoiceModeBlock(channelMeta?.voice || channel === "voice");

  return [
    sa.system || loadDefaultSystemPrompt(),
    buildUserContextBlock(identity, globalConfig),
    memoryBlock || buildSelfMemoryBlock(),
    activeThreadsBlock,
    relationshipBlock,
    buildPermissionBlock(sa),
    extraContext,
    "# Registered projects (just the index — call tools for details)",
    projectIndex || "(no projects registered)",
    buildProjectAgentsBlock(channelMeta?.projectPath),
    buildSkillsCatalog(listSkills),
    lazyToolsBlock,
    voiceModeBlock,
    systemSuffix,
  ]
    .filter(Boolean)
    .join("\n\n");
}
