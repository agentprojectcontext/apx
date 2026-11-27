// Domain shapes every client renders. Implementations are grouped by the part of the workflow they describe.

export {
  AppointmentMinutes,
  ChannelEmail,
  ChannelHours,
  ChannelInfo,
  ChannelResearch,
  LocalTranscription,
  MailServer,
  PairingRequest,
  ServiceDialect,
  ServiceKind,
} from "./domain-accounts.ts";
export {
  ApprovalScope,
  DeletionCard,
  FileChange,
  InputKind,
  InputState,
  PendingInput,
  STRICT_APPROVAL,
  ToolApproval,
} from "./domain-approvals.ts";
export {
  ARTIFACT_DB_MAX,
  ARTIFACT_STORE_MAX,
  ArtifactBundle,
  ArtifactManifest,
  ArtifactMemory,
  ArtifactOrigin,
  ArtifactSecretKey,
  ArtifactSqlParam,
  McpServerStatus,
  OutboxItem,
  OutboxState,
  Surface,
  SurfaceOrigin,
  SurfaceState,
  SurfaceSummary,
} from "./domain-artifacts.ts";
export { ChannelLimits, ChannelRooms, ChannelStrangers, ChannelType, RoomMode } from "./domain-channels.ts";
export {
  ChatgptStatus,
  Memory,
  MemoryEvidence,
  MemoryScope,
  ProviderInfo,
  ProviderTransport,
} from "./domain-memory.ts";
export { Message, MessageDelivery, MessageReaction, MessageWaiting, RunUsage, Sticker } from "./domain-messages.ts";
export {
  Agent,
  AgentListing,
  CatalogEngine,
  EngineStatus,
  HarnessId,
  MAX_MODEL_FALLBACKS,
  ModelAnnouncement,
  ModelChoice,
  ModelRef,
  RouterConfig,
  RouterRule,
} from "./domain-models.ts";
export { MemorySettings, NoticePrefs, Nudge, OwnerIdentity, OwnerPatch } from "./domain-owner.ts";
export { ConnectOffer, DocumentSource, Part, WorkflowStepState, WorkflowView } from "./domain-parts.ts";
export {
  AccountContactPerms,
  Address,
  AppointmentMode,
  ContactBooking,
  ContactRights,
  ContactSuggestion,
  contactRightsOf,
  Person,
  PersonPerms,
  PersonRelation,
  PersonRole,
  SuggestionState,
} from "./domain-people.ts";
export {
  AGENTS_MD_LIMIT,
  AgentRules,
  AUTONOMY_RULES,
  Autonomy,
  BASE_PROJECT_ID,
  BaseProject,
  DEFAULT_AUTONOMY,
  Id,
  OrgArea,
  Organization,
  OrgRole,
  Project,
  ProjectKind,
  RulePolicy,
  ToolRisk,
} from "./domain-projects.ts";
export { AuxPurpose, Job, JobFrom, PromptPart, Run, RunContext, RunTrigger } from "./domain-runs.ts";
export { ImageDefaults, LocalEmbedding, ServiceInfo, ServiceSettings, ServiceTest } from "./domain-services.ts";
export {
  Author,
  GroupSettings,
  MailMark,
  RunEndReason,
  RunState,
  TERMINAL_RUN_STATES,
  Thread,
  ThreadKind,
  WritePolicy,
} from "./domain-threads.ts";
