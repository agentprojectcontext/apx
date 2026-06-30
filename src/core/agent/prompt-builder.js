// Unified prompt builder for ANY agent (super-agent OR project agent).
//
// The system prompt is assembled from layered fragments:
//
//   1. core/agent-base.md      common: tool usage, memory, hard rules — applies to every agent
//   2. core/super-agent.md     OR  core/project-agent.md  — the role delta
//   3. # Agent profile         identity (name, personality, owner, language)
//   4. # Project / context     project pin, registered projects index, AGENTS.md
//   5. # Memory                self-memory or relevant memory block, active threads
//   6. # Channel               channel-specific formatting rules
//   7. # Discipline            action.md + (two-segment OR single-segment) + voice mode
//   8. # Suffix                channel-specific format directives (suggestions JSON, etc.)
//
// Sections are dropped when empty (no project context for super-agent on a
// generic CLI call, no self-memory for project agents, etc.).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readIdentity } from "../identity/index.js";
import { agentsMdFile } from "../apc/paths.js";
import { readSelfMemoryForPrompt } from "./self-memory.js";
import { buildSkillsHintBlock } from "./skills/catalog.js";
import { CHANNELS } from "#core/constants/channels.js";
import { activeEmotionGuide, buildEmotionGuide } from "../voice/emotions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");

// Channels are SURFACES. Voice is NOT a channel — it's a MODE that layers on
// top of a surface (see buildVoiceModeBlock); a spoken deck turn is channel
// "deck" + voice mode, not its own channel.
const CHANNEL_PROMPT_FILES = {
  [CHANNELS.TELEGRAM]: "channels/telegram.md",
  [CHANNELS.CLI]: "channels/cli.md",
  [CHANNELS.ROUTINE]: "channels/routine.md",
  [CHANNELS.API]: "channels/api.md",
  [CHANNELS.WEB]: "channels/web.md",
  [CHANNELS.WEB_SIDEBAR]: "channels/web_sidebar.md",
  [CHANNELS.WEB_CODE]: "channels/web_code.md",
  [CHANNELS.DECK]: "channels/deck.md",
  [CHANNELS.DESKTOP]: "channels/desktop.md",
  [CHANNELS.CODE]: "channels/code.md",
};

// Channels where the user CAN see two text segments per turn (chat history is
// visible). Voice / single-surface channels get single-segment discipline.
const TWO_SEGMENT_CHANNELS = new Set([
  CHANNELS.TELEGRAM,
  CHANNELS.WEB,
  CHANNELS.WEB_SIDEBAR,
  CHANNELS.WEB_CODE,
  CHANNELS.CODE,
  CHANNELS.API,
  CHANNELS.CLI,
]);

const VOICE_MODE_FILE = "modes/voice.md";

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

const promptCache = new Map();

export function loadPrompt(relativePath) {
  const key = relativePath.replace(/\\/g, "/");
  if (promptCache.has(key)) return promptCache.get(key);
  const text = fs.readFileSync(path.join(PROMPTS_DIR, key), "utf8").trimEnd();
  promptCache.set(key, text);
  return text;
}

const AGENT_BASE         = loadPrompt("core/agent-base.md");
const SUPER_AGENT_ROLE   = loadPrompt("core/super-agent.md");
const PROJECT_AGENT_ROLE = loadPrompt("core/project-agent.md");
const ACTION_DISCIPLINE  = loadPrompt("discipline/action.md");
const TWO_SEGMENT        = loadPrompt("discipline/two-segment.md");
const SINGLE_SEGMENT     = loadPrompt("discipline/single-segment.md");

// Back-compat shim — a few callers/tests still want the raw default prompt.
export function loadDefaultSystemPrompt() {
  return [AGENT_BASE, SUPER_AGENT_ROLE].join("\n\n");
}
export const DEFAULT_SYSTEM = loadDefaultSystemPrompt();

export function renderPromptTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null || value === "" ? "" : String(value);
  });
}

// ---------------------------------------------------------------------------
// Channel + mode blocks
// ---------------------------------------------------------------------------

export function buildChannelContextBlock(channel, meta = {}) {
  const rel = CHANNEL_PROMPT_FILES[String(channel || "").toLowerCase()];
  if (!rel) return "";
  return renderPromptTemplate(loadPrompt(rel), meta);
}

export function buildVoiceModeBlock(active, emotionGuide = "") {
  if (!active) return "";
  let base = "";
  try {
    base = loadPrompt(VOICE_MODE_FILE);
  } catch {
    base = "";
  }
  if (!emotionGuide) return base;
  return base ? `${base}\n\n${emotionGuide}` : emotionGuide;
}

// Pick the right segmenting discipline for the channel (and whether voice
// mode overrides it).
function buildSegmentDiscipline({ channel, voice }) {
  if (voice) return SINGLE_SEGMENT;
  if (TWO_SEGMENT_CHANNELS.has(String(channel || "").toLowerCase())) return TWO_SEGMENT;
  // routine / deck / desktop / unknown → single-segment (single visible reply)
  return SINGLE_SEGMENT;
}

// ---------------------------------------------------------------------------
// Project guidance — AGENTS.md of the pinned project, size-capped.
// ---------------------------------------------------------------------------

export const PROJECT_AGENTS_MAX_CHARS = 6000;

export function buildProjectAgentsBlock(projectPath) {
  if (!projectPath) return "";
  try {
    const file = agentsMdFile(projectPath);
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

// ---------------------------------------------------------------------------
// Identity / user / relationship blocks (shared across agents)
// ---------------------------------------------------------------------------

export function buildUserContextBlock(identity, globalConfig = {}, { agentName } = {}) {
  const user = globalConfig?.user || {};
  const lang = user.language || identity?.language || "en";
  const lines = ["# Agent profile"];

  const name = agentName || identity?.agent_name || globalConfig?.super_agent?.name;
  if (name) lines.push(`Your name is ${name}.`);
  if (identity?.personality) lines.push(`Your personality: ${identity.personality}.`);
  if (identity?.owner_name) lines.push(`Your owner is ${identity.owner_name}.`);
  if (identity?.owner_context) lines.push(`Owner context: ${identity.owner_context}`);

  lines.push(
    `Reply in the language with ISO 639-1 code "${lang}" unless the user explicitly switches language for that turn.`
  );
  if (user.locale) lines.push(`Preferred locale or dialect: ${user.locale}.`);
  if (user.timezone) {
    lines.push(
      `User timezone: ${user.timezone}. Use it for local time and schedules unless the user specifies otherwise.`
    );
  }

  return lines.join("\n");
}

/** Back-compat wrapper — second arg is ISO language only. */
export function buildIdentityBlock(identity, userLang = "en") {
  return buildUserContextBlock(identity, { user: { language: userLang } });
}

// "Who you're talking to" block — agent-agnostic, built once from the resolved
// sender (see core/identity/telegram.js). Returns "" when there's no sender.
export function buildRelationshipBlock(sender) {
  if (!sender || sender.userId == null) return "";
  const handle = sender.username ? ` (@${sender.username})` : "";
  const lines = ["# Who you're talking to"];

  if (sender.isGroup) {
    lines.push(
      "This is a Telegram GROUP chat with multiple people — do NOT assume a single owner."
    );
    lines.push(`Sender of this message: ${sender.name}${handle}, role: ${sender.role}.`);
  } else if (sender.isOwner) {
    lines.push(
      `You are talking to your owner, ${sender.name}. Treat them as the owner — never ask their name or who they are.`
    );
  } else if (sender.role && sender.role !== "guest") {
    lines.push(`You are talking to ${sender.name}${handle}, role: ${sender.role}.`);
  } else {
    lines.push(
      `You are talking to ${sender.name}${handle} (role: guest, no permissions). Politely ask who they are — you'll note it down but cannot grant any role yourself.`
    );
  }
  if (sender.note) lines.push(`Notes on this contact: ${sender.note}`);
  return lines.join("\n");
}

// Super-agent notebook (~/.apx/memory.md), bounded. Returns "" when empty.
// Project agents have their own per-agent memory.md handled in buildAgentSystem.
export function buildSelfMemoryBlock() {
  const slice = readSelfMemoryForPrompt();
  if (!slice) return "";
  return [
    "# Notebook",
    "Durable facts you chose to remember. Update with the `remember` tool. Read full with `read_self_memory` if truncated.",
    "",
    slice,
  ].join("\n");
}

export function isSuperAgentEnabled(cfg) {
  const sa = cfg && cfg.super_agent;
  if (!sa || !sa.model) return false;
  return sa.enabled !== false;
}

// ---------------------------------------------------------------------------
// Project index — renders the registered-project list cleanly when relevant.
// Omits the [kind] prefix when kind="default" so we don't get `[default] "default"`.
// ---------------------------------------------------------------------------

function buildProjectIndex(projects) {
  const list = projects?.list?.() || [];
  if (!list.length) return "";
  const lines = list.map((p) => {
    if (p.id === 0) return `  ${p.id}: "${p.name}" (global workspace, ${p.path})`;
    const kindTag = p.kind && p.kind !== "default" && p.kind !== "other" ? ` [${p.kind}]` : "";
    return `  ${p.id}:${kindTag} "${p.name}" (${p.path})`;
  });
  return ["# Registered projects (index only — call tools for details)", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Super-agent system prompt
// ---------------------------------------------------------------------------

export function buildSuperAgentSystem({
  globalConfig,
  projects,
  listSkills,
  contextNote = "",
  channel = "",
  channelMeta = {},
  // Pre-rendered "who you're talking to" block.
  relationshipBlock = "",
  // Channel-specific format directive appended at the very end (e.g.
  // ```suggestions``` block for voice/deck).
  systemSuffix = "",
  // Pre-rendered Memory Broker output ([RELEVANT MEMORY] block). When set, it
  // REPLACES the plain self-memory slice (it already includes the latest entries).
  memoryBlock = "",
  // Pre-rendered "# Active threads on other channels" block.
  activeThreadsBlock = "",
  // Compact "tools you can activate" hint (names of not-loaded tools).
  lazyToolsBlock = "",
  // When the skill inspector middleware is active, the daemon already injected
  // the right skill bodies/hints into contextNote — and the catalog-wide slug
  // dump becomes counterproductive (it nudges the model to load skills the
  // inspector explicitly decided not to surface). Setting this to true removes
  // buildSkillsHintBlock from the prompt.
  skipSkillsHint = false,
}) {
  const sa = globalConfig.super_agent || {};
  const identity = (() => {
    try { return readIdentity(); } catch { return null; }
  })();

  const channelLow = String(channel || "").toLowerCase();
  const voice = !!channelMeta?.voice || channelLow === "voice";

  // The super-agent's identity from config overrides the file-based delta when
  // sa.system is set explicitly (user tweaked the system prompt). Otherwise
  // we layer agent-base + super-agent role.
  const roleBlock = sa.system || [AGENT_BASE, SUPER_AGENT_ROLE].join("\n\n");

  // Additive personalization layered ON TOP of the role (unlike sa.system,
  // which fully replaces it). Lets the owner give the super-agent durable
  // custom instructions without rewriting the whole base prompt.
  const customInstructions =
    sa.instructions && String(sa.instructions).trim()
      ? `# Custom instructions\n${String(sa.instructions).trim()}`
      : "";

  const channelBlock = buildChannelContextBlock(channel, channelMeta);
  const extraContext = [channelBlock, contextNote].filter(Boolean).join("\n\n");
  // In voice mode, if the engine that will speak supports inline emotion tags
  // (a per-engine config toggle), teach the agent the syntax. channelMeta
  // .ttsProvider optionally forces which engine's capability to honor.
  const emotion = voice ? activeEmotionGuide(globalConfig, channelMeta?.ttsProvider) : null;
  const voiceBlock = buildVoiceModeBlock(
    voice,
    emotion ? buildEmotionGuide(emotion.tags) : ""
  );
  const segmentDiscipline = buildSegmentDiscipline({ channel: channelLow, voice });

  return [
    roleBlock,
    buildUserContextBlock(identity, globalConfig),
    customInstructions,
    memoryBlock || buildSelfMemoryBlock(),
    activeThreadsBlock,
    relationshipBlock,
    extraContext,
    buildProjectIndex(projects),
    buildProjectAgentsBlock(channelMeta?.projectPath),
    skipSkillsHint ? "" : buildSkillsHintBlock(listSkills),
    lazyToolsBlock,
    voiceBlock,
    ACTION_DISCIPLINE,
    segmentDiscipline,
    systemSuffix,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Shared exports re-used by build-agent-system.js
// ---------------------------------------------------------------------------

export const PROMPTS = {
  AGENT_BASE,
  SUPER_AGENT_ROLE,
  PROJECT_AGENT_ROLE,
  ACTION_DISCIPLINE,
  TWO_SEGMENT,
  SINGLE_SEGMENT,
};

export { buildSegmentDiscipline };
