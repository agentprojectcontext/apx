// Super-agent: daemon-level action agent for Telegram, TUI, overlay, routines.
import { schemasForChannel, makeToolHandlers } from "./super-agent-tools/index.js";
import { listSkills } from "./skills-loader.js";
import {
  runAgent,
  buildSuperAgentSystem,
  isSuperAgentEnabled,
  buildIdentityBlock,
  loadDefaultSystemPrompt,
} from "../../core/agent/index.js";
import { resolveAgentName } from "../../core/identity.js";
import { memoryBlockFor } from "../../core/memory/index.js";

export {
  buildIdentityBlock,
  isSuperAgentEnabled,
};
export const DEFAULT_SYSTEM = loadDefaultSystemPrompt();

export async function runSuperAgent({
  globalConfig,
  projects,
  plugins,
  registries,
  prompt,
  contextNote = "",
  channel = "",
  channelMeta = {},
  // Pre-rendered "who you're talking to" block (see buildRelationshipBlock).
  relationshipBlock = "",
  previousMessages = [],
  overrideModel = null,
  onEvent = null,
  signal,
  onToken = null,
  suppressTools = null,
  // Channel-specific addendum appended to the system prompt; used by
  // voice.js to ask for trailing ```suggestions``` JSON on voice/deck
  // surfaces. Optional; ignored if empty.
  systemSuffix = "",
  // Per-reply output cap; forwarded to runAgent. Summarize/ask raise it.
  maxTokens,
  // Run tool-free: pure text generation, no tool registry. Used by the
  // summarize/ask endpoint so a transcript that *mentions* a tool (e.g. the
  // telegram plugin) can't make the model actually fire it.
  noTools = false,
  // Role-based tool allowlist. "*" (default) means no restriction; an array
  // restricts the visible tool schemas to those names; [] means no tools.
  // Used to gate guests/limited roles on Telegram (see resolveAllowedTools).
  allowedTools = "*",
}) {
  if (!isSuperAgentEnabled(globalConfig)) {
    throw new Error("super-agent not enabled (set super_agent.enabled and .model in ~/.apx/config.json)");
  }

  const sa = globalConfig.super_agent;

  // Memory Broker (Pieza 4): assemble the [MEMORIA RELEVANTE] block before the
  // turn. Silent + bounded (≤ broker_budget_ms); skipped for tool-free callers
  // (summarize/ask) where injected context would only confuse the transcript.
  let memoryBlock = "";
  if (!noTools) {
    memoryBlock = await memoryBlockFor(prompt, { config: globalConfig, channel });
  }

  const system = buildSuperAgentSystem({
    globalConfig,
    projects,
    listSkills,
    contextNote,
    channel,
    channelMeta,
    relationshipBlock,
    systemSuffix,
    memoryBlock,
  });

  // Pick the schema subset for this channel: chit-chat surfaces get a small
  // "core" set (~700 tokens) to fit cheap-tier TPM caps; routines get the
  // full registry. The model can still call load_skill / read more on demand.
  // noTools callers (summarize/ask) get an empty set — text only.
  let toolSchemas = noTools ? [] : schemasForChannel(channel);
  // Role gating: restrict the visible tools for limited senders (e.g. guests
  // on Telegram). "*" = unrestricted; [] = no tools; array = allowlist.
  if (allowedTools !== "*" && Array.isArray(allowedTools)) {
    if (allowedTools.length === 0) {
      toolSchemas = [];
    } else {
      const allow = new Set(allowedTools);
      toolSchemas = toolSchemas.filter((t) => allow.has(t?.function?.name || t?.name));
    }
  }

  return runAgent({
    globalConfig,
    system,
    prompt,
    previousMessages,
    overrideModel,
    toolSchemas,
    makeToolHandlers,
    toolHandlerCtx: { projects, plugins, registries, globalConfig, channel },
    onEvent,
    signal,
    onToken,
    agentName: resolveAgentName(globalConfig),
    suppressTools,
    ...(maxTokens ? { maxTokens } : {}),
  });
}
