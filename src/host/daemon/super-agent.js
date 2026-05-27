// Super-agent: daemon-level action agent for Telegram, TUI, overlay, routines.
import { TOOL_SCHEMAS, makeToolHandlers } from "./super-agent-tools/index.js";
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
  });

  return runAgent({
    globalConfig,
    system,
    prompt,
    previousMessages,
    overrideModel,
    toolSchemas: TOOL_SCHEMAS,
    makeToolHandlers,
    toolHandlerCtx: { projects, plugins, registries, globalConfig },
    onEvent,
    signal,
    onToken,
    agentName: sa.name || "apx",
    suppressTools,
  });
}
