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
}) {
  if (!isSuperAgentEnabled(globalConfig)) {
    throw new Error("super-agent not enabled (set super_agent.enabled and .model in ~/.apx/config.json)");
  }

  const sa = globalConfig.super_agent;
  const system = buildSuperAgentSystem({
    globalConfig,
    projects,
    listSkills,
    contextNote,
    channel,
    channelMeta,
    systemSuffix,
  });

  // Pick the schema subset for this channel: chit-chat surfaces get a small
  // "core" set (~700 tokens) to fit cheap-tier TPM caps; routines get the
  // full registry. The model can still call load_skill / read more on demand.
  const toolSchemas = schemasForChannel(channel);

  return runAgent({
    globalConfig,
    system,
    prompt,
    previousMessages,
    overrideModel,
    toolSchemas,
    makeToolHandlers,
    toolHandlerCtx: { projects, plugins, registries, globalConfig },
    onEvent,
    signal,
    onToken,
    agentName: sa.name || "apx",
    suppressTools,
  });
}
