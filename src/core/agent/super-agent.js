// Super-agent: daemon-level action agent for Telegram, TUI, desktop, routines.
import { createToolSession, buildLazyToolsBlock, makeToolHandlers } from "#core/agent/tools/registry.js";
import { listSkills } from "#core/agent/skills/loader.js";
import { filterEnabledSkills } from "#core/agent/skills/policy.js";
import {
  runAgent,
  buildSuperAgentSystem,
  isSuperAgentEnabled,
  buildIdentityBlock,
  loadDefaultSystemPrompt,
} from "#core/agent/index.js";
import { resolveAgentName } from "#core/identity/index.js";
import { memoryBlockFor, buildActiveThreadsBlock } from "#core/memory/index.js";
import { CHANNELS } from "#core/constants/channels.js";

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
  // Max tool-loop iterations; forwarded to runAgent. The Code module raises
  // this so coding tasks run to completion instead of stopping after a step.
  maxIters,
  // Structural "keep going until done" contract (finish tool + forced tool
  // choice). Coding surfaces (web Code build mode, terminal Build) turn this on.
  completionContract = false,
  // Run tool-free: pure text generation, no tool registry. Used by the
  // summarize/ask endpoint so a transcript that *mentions* a tool (e.g. the
  // telegram plugin) can't make the model actually fire it.
  noTools = false,
  // Role-based tool allowlist. "*" (default) means no restriction; an array
  // restricts the visible tool schemas to those names; [] means no tools.
  // Used to gate guests/limited roles on Telegram (see resolveAllowedTools).
  allowedTools = "*",
  // Channel-specific confirmation handler. See run-agent.js for contract.
  // Null disables human-in-the-loop (tools that need confirmation fail
  // immediately instead of waiting for user input).
  requestConfirmation = null,
  // A2A callback sink: when a background tool (call_runtime) finishes out of
  // band, it feeds the result back into the super-agent via this function so
  // the agent — not a raw dump — relays it to the user. Channel-specific
  // (telegram wires it to a follow-up streamed turn). Null → tools fall back to
  // a direct channel send. See call-runtime.js.
  backgroundResultSink = null,
  // When true, suppress the static "Available skills" slug-dump hint block
  // because a per-turn skill inspector already injected the right context.
  // Set by the daemon's super-agent endpoint when config.skills.inspector is on.
  skipSkillsHint = false,
}) {
  if (!isSuperAgentEnabled(globalConfig)) {
    throw new Error("super-agent not enabled (set super_agent.enabled and .model in ~/.apx/config.json)");
  }

  const sa = globalConfig.super_agent;

  // Memory Broker (Pieza 4): assemble the [MEMORIA RELEVANTE] block before the
  // turn. Silent + bounded (≤ broker_budget_ms); skipped for tool-free callers
  // (summarize/ask) where injected context would only confuse the transcript.
  let memoryBlock = "";
  let activeThreadsBlock = "";
  if (!noTools) {
    memoryBlock = await memoryBlockFor(prompt, { config: globalConfig, channel });
    // "Hilos activos en otros canales" — pure-recency cross-channel awareness.
    // Skipped for autonomous routines (no human to reference other threads).
    if (channel !== CHANNELS.ROUTINE) {
      try {
        activeThreadsBlock = buildActiveThreadsBlock(channel, { config: globalConfig });
      } catch {
        /* best-effort */
      }
    }
  }

  // Per-turn tool session. Lightweight channels (telegram/desktop/deck) start
  // on the small "base" set and expand on demand via discover_tools; full
  // channels (routine/api/web/code/terminal) get the whole registry up front.
  // The session also enforces role gating ("*" = unrestricted, [] = none,
  // array = allowlist) on BOTH the initial set and any later activation, so a
  // limited sender can't discover its way past the gate.
  // noTools callers (summarize/ask) get no session — text only.
  const toolSession = noTools ? null : createToolSession(channel, { allowedTools });

  // Scope the catalog hint to the skills enabled for this project (or the
  // super-agent baseline when no project). Built-in/private skills always pass.
  const projectPath = channelMeta?.projectPath;
  const scopedListSkills = (opts = {}) =>
    filterEnabledSkills(listSkills(opts), { config: globalConfig, projectPath });

  const system = buildSuperAgentSystem({
    globalConfig,
    projects,
    listSkills: scopedListSkills,
    contextNote,
    channel,
    channelMeta,
    relationshipBlock,
    systemSuffix,
    memoryBlock,
    activeThreadsBlock,
    // Compact "tools you can activate" block (names only, no schemas). Empty on
    // full channels and tool-free callers, where it's omitted from the prompt.
    lazyToolsBlock: buildLazyToolsBlock(toolSession),
    skipSkillsHint,
  });

  const toolSchemas = noTools ? [] : toolSession.initialSchemas;

  return runAgent({
    globalConfig,
    system,
    prompt,
    previousMessages,
    overrideModel,
    toolSchemas,
    makeToolHandlers,
    toolHandlerCtx: { projects, plugins, registries, globalConfig, channel, channelMeta, toolSession, requestConfirmation, backgroundResultSink },
    onEvent,
    signal,
    onToken,
    agentName: resolveAgentName(globalConfig),
    suppressTools,
    ...(maxTokens ? { maxTokens } : {}),
    ...(maxIters ? { maxIters } : {}),
    ...(completionContract ? { completionContract: true } : {}),
  });
}
