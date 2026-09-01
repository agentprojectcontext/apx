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
import { renderPromptTemplate } from "./render-template.js";
import { buildProfileBlock, buildProfileChannelBlock } from "../profiles/block.js";

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
  [CHANNELS.A2A]: "channels/a2a.md",
  // A relay, not a chat surface APX owns: a bridge on the owner's phone posts
  // the message here and carries the answer back. Without this block a WhatsApp
  // turn got no channel context at all — the agent answered the sender as if it
  // were the owner and the owner never heard that anyone had written.
  [CHANNELS.WHATSAPP]: "channels/whatsapp.md",
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

// Re-exported so the many callers importing it from here keep working; the
// implementation lives in render-template.js to avoid an import cycle with the
// modules that build prompt blocks.
export { renderPromptTemplate };

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

// Budget guard for a FOREIGN project's AGENTS.md — a project we were merely
// pointed at should not be able to blow the prompt budget. It is deliberately
// generous: a real contract runs well past the old 6k cap, and a contract that
// arrives half-read is worse than none (the agent follows the rules it can see
// and silently violates the ones it cannot).
//
// Two escape hatches, because truncating a contract is never harmless:
//   - `super_agent.project_agents_max_chars` overrides it; 0 disables the cap.
//   - The project APX is *running inside* is never capped (see isOwnProject).
export const PROJECT_AGENTS_MAX_CHARS = 24000;

// The project that owns the running process reads its own contract in full.
// This is the dogfood case: `apx exec` inside a repo, or the daemon started
// from it. Capping there truncated APX's own AGENTS.md mid-rule.
function isOwnProject(projectPath) {
  try {
    return path.resolve(projectPath) === path.resolve(process.cwd());
  } catch {
    return false;
  }
}

function resolveAgentsCap(projectPath, globalConfig) {
  if (isOwnProject(projectPath)) return 0;
  const raw = globalConfig?.super_agent?.project_agents_max_chars;
  if (raw === 0) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PROJECT_AGENTS_MAX_CHARS;
}

// Cut on a line boundary so a rule is never severed mid-sentence, and say what
// was dropped — a bare "…(truncated)" gives the agent no way to know it is
// operating on a partial contract.
function capAgentsText(text, max) {
  if (!max || text.length <= max) return text;
  const head = text.slice(0, max);
  const lastBreak = head.lastIndexOf("\n");
  const kept = lastBreak > max * 0.5 ? head.slice(0, lastBreak) : head;
  const dropped = text.length - kept.length;
  return (
    `${kept.trimEnd()}\n\n…(AGENTS.md truncated: ${dropped} of ${text.length} characters omitted. ` +
    `Read the file directly before relying on rules not shown above.)`
  );
}

export function buildProjectAgentsBlock(projectPath, globalConfig = {}) {
  if (!projectPath) return "";
  try {
    const file = agentsMdFile(projectPath);
    if (!fs.existsSync(file)) return "";
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return "";
    const capped = capAgentsText(text, resolveAgentsCap(projectPath, globalConfig));
    return `# Project guidance (AGENTS.md)\n\nStartup rules for THIS project — follow them:\n\n${capped}`;
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

// Which engine is answering, right now.
//
// The model id lives in config, never in the weights, so an agent asked "what
// model are you?" has nothing to read but its own notebook — and a note that
// was true in June is a lie in August. Roby spent a day telling its owner it
// ran on gemini while it ran on Zen, then wrote that down as a verified fact,
// which made the next answer more confident and just as wrong.
//
// So the truth is stated fresh on every call. It goes LAST in the system
// prompt, after the notebook, because the whole job of this block is to
// outrank a stale note about the same subject.
export function buildRuntimeBlock(modelId) {
  if (!modelId) return "";
  return [
    "# Engine answering this turn",
    `Right now you are running on \`${modelId}\` (provider:model, as configured in APX).`,
    "This line is regenerated on every call — it describes THIS turn, and it is the only reliable source for it.",
    "If your notebook, your memory or something earlier in this conversation names a different model, that source is stale: answer with the model above, and correct the note.",
    "Never record the model you are running on as a durable fact — it changes with config, and this line will always know better than a note.",
  ].join("\n");
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
  // An active profile may add its own guidance for THIS surface, appended after
  // the core channel file (which keeps owning the channel's formatting rules).
  // It is how a profile gets a deterministic rule loaded exactly where the
  // decision it governs is taken — see core/profiles/block.js. "" when there is
  // no profile or no overlay for this channel.
  const profileChannelBlock = buildProfileChannelBlock(
    channelLow,
    identity,
    globalConfig,
    channelMeta
  );
  const extraContext = [channelBlock, profileChannelBlock, contextNote]
    .filter(Boolean)
    .join("\n\n");
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
    // Installed agent profile, when one is active. "" for vanilla — and an
    // empty block is filtered out below, so a vanilla prompt is byte-identical
    // to what it was before profiles existed. Sits after identity (the profile
    // needs to know who it serves) and before customInstructions (whatever the
    // owner writes themselves must win on recency).
    buildProfileBlock(identity, globalConfig),
    customInstructions,
    memoryBlock || buildSelfMemoryBlock(),
    activeThreadsBlock,
    relationshipBlock,
    extraContext,
    buildProjectIndex(projects),
    buildProjectAgentsBlock(channelMeta?.projectPath, globalConfig),
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
