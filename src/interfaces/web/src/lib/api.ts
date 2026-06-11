// Backwards-compatible umbrella for existing imports. New code should
// pull from src/lib/api/<domain>.ts directly via the named re-exports below.
export { setToken, getToken, http, streamNdjson, HttpError } from "./http";

export * from "./api/health";
export * from "./api/projects";
export * from "./api/agents";
export * from "./api/conversations";
export * from "./api/routines";
export * from "./api/tasks";
export * from "./api/mcps";
export * from "./api/messages";
export * from "./api/sessions";
export * from "./api/tools";
export * from "./api/telegram";
export * from "./api/engines";
export * from "./api/admin";
export * from "./api/identity";
export * from "./api/super_agent";
export * from "./api/filesystem";
export * from "./api/voice";
export * from "./api/deck";
export * from "./api/code";
export * from "./api/artifacts";
export * from "./api/skills";

// Re-export the daemon types so older imports of "../lib/api" still work.
export type {
  ProjectKind,
  ProjectEntry,
  AgentEntry,
  AgentDetail,
  RoutineEntry,
  TaskEntry,
  McpEntry,
  MessageEntry,
  TelegramChannel,
  TelegramChannelsResponse,
  EngineSummary,
  HealthSummary,
  ConversationListEntry,
  ConversationDetail,
  ConversationMessage,
  PairedClient,
  ProjectConfig,
  Identity,
  SuperAgentConfig,
  GlobalConfig,
  ChatStreamEvent,
} from "../types/daemon";
