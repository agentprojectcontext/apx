// Methods behind the app screens: agents, projects, threads, surfaces.
import { z } from "zod";
import { composerMethods } from "./composer-methods.ts";
import {
  Agent,
  AgentListing,
  AgentRules,
  ApprovalScope,
  Author,
  Autonomy,
  AuxPurpose,
  BaseProject,
  CatalogEngine,
  ChannelClosers,
  ChannelEmail,
  ChannelInfo,
  ChannelResearch,
  ChannelRooms,
  ChannelStrangers,
  ChannelType,
  ChatgptStatus,
  ContactSuggestion,
  EngineStatus,
  Id,
  ImageDefaults,
  Job,
  LocalEmbedding,
  LocalTranscription,
  Memory,
  MemoryEvidence,
  MemoryScope,
  MemorySettings,
  Message,
  ModelChoice,
  NoticePrefs,
  Nudge,
  Organization,
  OutboxItem,
  OutboxState,
  OwnerIdentity,
  PairingRequest,
  PendingInput,
  Person,
  PersonRelation,
  PersonRole,
  Project,
  ProjectKind,
  ProviderInfo,
  ProviderTransport,
  RoomMode,
  RouterConfig,
  Run,
  ServiceInfo,
  ServiceKind,
  ServiceSettings,
  ServiceTest,
  Surface,
  SurfaceOrigin,
  SurfaceState,
  SurfaceSummary,
  Thread,
  ToolApproval,
  ToolRisk,
  WritePolicy,
} from "./domain.ts";
import { filesMethods } from "./files-methods.ts";
import { gitMethods } from "./git-methods.ts";
import { officeMethods } from "./office-methods.ts";
import { resourceMethods } from "./resource-methods.ts";
import { teamMethods } from "./team-methods.ts";

/** The parts of APX v1 the setup can bring in. */
const V1Group = z.enum([
  "projects",
  "skills",
  "keys",
  "vars",
  "mcps",
  "memory",
  "embeddings",
  "services",
  "identity",
  "chats",
  "channels",
  "tasks",
  "commitments",
  "routines",
]);

/**
 * What an agent's message on a channel left: its chat, the end of that chat before it (so the agent knows what was
 * already said), and how the send went after a few seconds (refused: `failed` with the platform's reason; a channel
 * that is down: still `queued`).
 */
const Sent = z.object({
  thread: Id,
  channel: z.string(),
  recent: z.array(z.object({ from: z.enum(["them", "you", "owner"]), text: z.string() })),
  delivery: z.object({ state: OutboxState, error: z.string().optional() }),
});

const MemoryJobs = z.array(
  z.object({
    id: Id,
    kind: z.string(),
    agent_id: Id,
    thread_id: Id,
    state: z.string(),
    attempts: z.number().int(),
    updated_at: z.string(),
    result: z.string().nullable(),
    error: z.string().nullable(),
  }),
);

export const appMethods = {
  "memory.status": {
    params: z.object({}).strict(),
    result: z.object({ jobs: MemoryJobs }),
    effect: false,
    access: "human",
  },
  ...officeMethods,
  ...teamMethods,
  ...resourceMethods,
  ...composerMethods,
  ...filesMethods,
  ...gitMethods,
  /**
   * Read-only import from a local APX v1: registers the project folders it knows (their .apc/ is read from disk)
   * and, when asked, copies once into v2's own home: its model API keys (`keys`), its skills (`skills`), and its image
   * engines and voices (`services`).
   */
  /**
   * Where the owner is in the first-run setup: done or not, whether this install is new (nothing said in it yet) and
   * the APX v1 found on this machine, if any (counts only).
   */
  "setup.status": {
    params: z.object({}).strict(),
    result: z.object({
      done: z.boolean(),
      fresh: z.boolean(),
      v1: z
        .object({
          home: z.string(),
          version: z.string().optional(),
          agent_name: z.string().optional(),
          /** The super-agent's face in v1 (a blob name), shown before the import brings it. */
          agent_blob: z.string().optional(),
          owner_name: z.string().optional(),
          projects: z.number().int(),
        })
        .nullable(),
      /** The folder of this APX's command (apps/terminal), to put `apx` on the PATH from there. */
      terminal: z.string().optional(),
      /** APX v1's daemon still answers beside this one: routines and bots would run twice. */
      v1_running: z.boolean().optional(),
    }),
    effect: false,
    access: "human",
  },
  /** What APX v1 has, per group: how many (and, for projects, their agents; for channels, their contacts). */
  "setup.v1_scan": {
    params: z.object({}).strict(),
    result: z.object({
      groups: z.array(z.object({ id: V1Group, count: z.number().int(), detail: z.string().optional() })),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Brings the chosen v1 groups into v2, reading v1's folder only. Routines come in off (v1 may still run them); a
   * Telegram bot v2 already has stays.
   */
  "setup.import_v1": {
    params: z.object({ groups: z.array(V1Group).min(1) }).strict(),
    result: z.object({ imported: z.record(z.string(), z.number().int()), errors: z.array(z.string()) }),
    effect: true,
    access: "human",
  },
  /** The setup is over: it does not open again by itself. */
  /**
   * Makes the `apx` command this APX: v1's global package is removed and this checkout's terminal is linked in its
   * place. v1's files stay where they are.
   */
  "setup.take_over_cli": {
    params: z.object({}).strict(),
    result: z.object({ ok: z.boolean(), detail: z.string() }),
    effect: true,
    access: "human",
  },
  /**
   * The super-agent greets the owner in its chat (in `language`), asking who they are and how it should be, with a few
   * personalities to pick. Once per install, and only into an empty chat; `sent` says whether it greeted now.
   */
  "setup.greet": {
    params: z.object({ language: z.string().regex(/^[a-z]{2}$/) }).strict(),
    result: z.object({ thread: Id, sent: z.boolean() }),
    effect: true,
    access: "human",
  },
  "setup.finish": {
    params: z.object({}).strict(),
    result: z.object({ done: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /**
   * Whether a newer APX is out: for a checkout, commits on main it does not have; for a daemon installed from a bundle,
   * newer releases; for the core the desktop app carries (`app`), newer releases the app installs. `check` asks now.
   */
  "system.updates": {
    params: z.object({ check: z.boolean().default(false) }).strict(),
    result: z.object({
      source: z.enum(["git", "release", "app", "none"]),
      behind: z.number().int(),
      latest: z.string().optional(),
      changes: z.array(z.string()),
      checked_at: z.string().optional(),
      error: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Brings the newer APX in: a checkout pulls (fast-forward only), installs and builds the panel; a bundle install
   * downloads the newer bundle, checks it and makes it current. `restart`: the core starts again with it now; otherwise
   * the owner restarts APX.
   */
  "system.update": {
    params: z.object({}).strict(),
    result: z.object({ ok: z.boolean(), restart: z.boolean(), log: z.string() }),
    effect: true,
    access: "human",
  },
  // Release news the super-agent tells the owner (DECISIONS.md#d-116).
  /** The news APX carries: whether each was told (or known from the start) and whether it applies to this owner. */
  "system.news": {
    params: z.object({}).strict(),
    result: z.object({
      entries: z.array(
        z.object({
          id: z.string(),
          since: z.string(),
          title: z.string(),
          seen: z.boolean(),
          applies: z.boolean(),
          actions: z.array(z.string()),
        }),
      ),
    }),
    effect: false,
  },
  /**
   * Tells news now, as a start would: the given entries even if told or not applying (a replay), else the unseen ones
   * that apply. `voiced`: the super-agent's model wrote it; `sent`: a channel or the phone took it.
   */
  "system.news_tell": {
    params: z.object({ ids: z.array(z.string().max(80)).max(20).optional() }).strict(),
    result: z.object({
      told: z.array(z.string()),
      thread: z.string().optional(),
      sent: z.boolean(),
      voiced: z.boolean(),
    }),
    effect: true,
    access: "human",
  },
  "system.import_v1": {
    params: z
      .object({
        keys: z.boolean().default(false),
        skills: z.boolean().default(false),
        services: z.boolean().default(false),
      })
      .strict(),
    result: z.object({
      projects: z.number().int(),
      agents: z.number().int(),
      keys: z.array(z.string()),
      skills: z.array(z.string()).default([]),
      services: z.array(z.string()).default([]),
    }),
    effect: true,
    access: "human",
  },
  "secrets.set": {
    params: z
      .object({
        /** The same shape `secret://NAME` references accept (an MCP env var name like GH_TOKEN works as is). */
        name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
        /** null removes it. */
        value: z.string().min(1).max(16_384).nullable(),
        /** A project's own value, over the global one for that project's MCP servers. */
        project: Id.optional(),
      })
      .strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "agents.list": {
    params: z.object({}).strict(),
    /** `former`: agents archived or deleted, so the chats they spoke in still show their name and face. */
    result: z.object({ agents: z.array(AgentListing), former: z.array(Agent).default([]) }),
    effect: false,
  },
  /**
   * Creates an agent. With a project it is written as .apc/agents/<slug>.md in that project's folder (the file is
   * the definition); without one it is a global agent kept by APX.
   */
  "agents.create": {
    params: z
      .object({
        project_id: Id.optional(),
        slug: z
          .string()
          .regex(/^[a-z][a-z0-9_-]*$/)
          .max(64),
        name: z.string().min(1).max(80),
        role: z.string().max(200).default(""),
        description: z.string().max(2000).optional(),
        prompt: z.string().max(100_000).default(""),
        parent: z.string().max(64).optional(),
        blob: z.string().max(40).optional(),
        model_choice: ModelChoice.optional(),
        area: z.string().trim().max(60).optional(),
        personality: z.string().max(1000).optional(),
        orchestrator: z.boolean().optional(),
      })
      .strict(),
    result: Agent,
    effect: true,
    access: "human",
  },
  /** Removes an agent: a project agent's file moves to .apc/agents/.archived/ (never deleted); threads keep it. */
  "agents.archive": {
    params: z.object({ agent: Id }).strict(),
    result: z.object({ ok: z.literal(true), moved_to: z.string().optional() }),
    effect: true,
    access: "human",
  },
  /** Archived agents (every project's, or one's): the owner brings one back or deletes it for good. */
  "agents.archived": {
    params: z.object({ project_id: Id.optional() }).strict(),
    result: z.object({ agents: z.array(Agent) }),
    effect: false,
    access: "human",
  },
  /** Brings an archived agent back: a project agent's file returns to .apc/agents/ and it shows again. */
  "agents.restore": {
    params: z.object({ agent: Id }).strict(),
    result: Agent,
    effect: true,
    access: "human",
  },
  /** Deletes an archived agent for good: its file and its own notes go; the chats it was in keep its name. */
  "agents.delete": {
    params: z.object({ agent: Id }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /**
   * APX's own tools an agent's list may name, with the group each belongs to; `kept` ones every agent keeps. MCP
   * tools are named as `mcp_<server>_*` or one by one.
   */
  "agents.tools": {
    params: z.object({}).strict(),
    result: z.object({
      tools: z.array(z.object({ name: z.string(), group: z.string().optional(), kept: z.boolean(), risk: ToolRisk })),
    }),
    effect: false,
    access: "human",
  },
  /** One agent with its prompt (the system prompt the owner writes; lists leave it out). */
  "agents.get": {
    params: z.object({ agent: Id }).strict(),
    result: z.object({ agent: Agent, prompt: z.string() }),
    effect: false,
    access: "human",
  },
  "agents.update": {
    params: z
      .object({
        agent: Id,
        browser_profile: z.enum(["shared", "isolated", "incognito"]).optional(),
        /** null = back to the install default. */
        model_choice: ModelChoice.nullable().optional(),
        /** Definition fields: written to the agent's file for project agents. */
        name: z.string().min(1).max(80).optional(),
        role: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
        /** The team area it belongs to (shown as a pill on the team chart). */
        area: z.string().trim().max(60).optional(),
        prompt: z.string().max(100_000).optional(),
        /** How it comes across, apart from its instructions ("" clears it). */
        personality: z.string().max(1000).optional(),
        /** How often it stops for the owner's yes; null: none of its own, as far as its project says. Owner only. */
        autonomy: Autonomy.nullable().optional(),
        parent: z.string().max(64).optional(),
        blob: z.string().max(40).optional(),
        /** The tools (or groups) it may use, and the skills it works with; [] goes back to all of them. */
        tools: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
        skills: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
        /** Runs its team (false clears it). */
        orchestrator: z.boolean().optional(),
        /** Its own rules by risk; null: none, its autonomy decides. Owner only. */
        rules: AgentRules.nullable().optional(),
        /** Renames the file (project agents); the agent keeps its id and the old slug is kept as an alias. */
        slug: z
          .string()
          .regex(/^[a-z][a-z0-9_-]*$/)
          .max(64)
          .optional(),
      })
      .strict(),
    result: Agent,
    effect: true,
    access: "human",
  },
  /**
   * Narrows or changes a grant for good (one agent's, or every agent's without `agent`): only calls matching
   * `condition`, until `expires_at`. Empty strings clear them.
   */
  "tools.grant_set": {
    params: z
      .object({
        key: z.string().min(1),
        agent: Id.optional(),
        condition: z.string().max(200).optional(),
        expires_at: z.string().datetime().or(z.literal("")).optional(),
      })
      .strict(),
    result: z.object({ approval: ToolApproval }),
    effect: true,
    access: "human",
  },
  /** Every engine with the models it offers, asked to the engine (cached for a day; `refresh` asks again). */
  "models.list": {
    params: z.object({ refresh: z.boolean().default(false) }).strict(),
    result: z.object({ engines: z.array(CatalogEngine) }),
    effect: false,
  },
  /** The install default for agents without their own choice, and the router. */
  "models.config": {
    params: z.object({}).strict(),
    result: z.object({ default: ModelChoice, router: RouterConfig }),
    effect: false,
  },
  "models.set_config": {
    params: z.object({ default: ModelChoice.optional(), router: RouterConfig.optional() }).strict(),
    result: z.object({ default: ModelChoice, router: RouterConfig }),
    effect: true,
    access: "human",
  },
  "engines.status": {
    params: z.object({ refresh: z.boolean().default(false) }).strict(),
    result: z.object({ engines: z.array(EngineStatus) }),
    effect: false,
  },
  /** Internal: an external harness (Codex) lists the tools of the run that owns `token`. */
  "harness.tools": {
    params: z.object({ token: z.string().min(32).max(128) }).strict(),
    result: z.object({
      tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.unknown() })),
    }),
    effect: false,
  },
  /** Internal: an external harness calls one APX tool inside the run that owns `token`. */
  "harness.call": {
    params: z
      .object({ token: z.string().min(32).max(128), tool: z.string(), args: z.record(z.string(), z.unknown()) })
      .strict(),
    result: z.object({ ok: z.boolean(), text: z.string() }),
    effect: true,
  },
  "projects.list": {
    params: z.object({ include_unregistered: z.boolean().default(false) }).strict(),
    /** `base`: how the owner named, described and typed the base project (it has no folder of its own). */
    result: z.object({ projects: z.array(Project), base: BaseProject }),
    effect: false,
  },
  /** Names, describes or types the base project; "" or null removes a description or kind. */
  "projects.update_base": {
    params: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        kind: ProjectKind.nullable().optional(),
        /** How far agents without one of their own go here; null = auto. */
        autonomy: Autonomy.nullable().optional(),
      })
      .strict(),
    result: z.object({ base: BaseProject }),
    effect: true,
    access: "human",
  },
  /** A project's areas and roles (no project: the base project's). Empty until the owner or a team adds some. */
  "org.get": {
    params: z.object({ project: Id.optional() }).strict(),
    result: Organization,
    effect: false,
  },
  /** Replaces a project's areas and roles: written to its .apc/organization.json (the base project's: in APX). */
  "org.set": {
    params: z.object({ project: Id.optional(), organization: Organization }).strict(),
    result: Organization,
    effect: true,
    access: "human",
  },
  /** Registers a folder as a project and reads its AGENTS.md and .apc/ (never writes them). */
  "projects.register": {
    params: z
      .object({
        path: z.string().min(1).max(1024),
        /** A plain folder becomes a project: an AGENTS.md naming it and an empty .apc/ are written there. */
        init: z.boolean().default(false),
      })
      .strict(),
    result: z.object({ project: Project, agents: z.number().int() }),
    effect: true,
    access: "human",
  },
  /**
   * A new project: in a folder (made if missing; a plain one gets an AGENTS.md and .apc/), or, without one, in a folder
   * of its own inside APX's home (`projects/<name>`). Name, kind and description go to its .apc/project.json; a project
   * in a folder with no name given keeps the folder's.
   */
  "projects.create": {
    params: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        kind: ProjectKind.optional(),
        description: z.string().trim().max(500).optional(),
        path: z.string().trim().min(1).max(1024).optional(),
      })
      .strict()
      .refine((p) => p.name || p.path, "a name or a folder"),
    result: z.object({ project: Project, agents: z.number().int() }),
    effect: true,
    access: "human",
  },
  /**
   * Renames a project, or changes its description or kind, in its .apc/project.json (every other key there stays).
   * An empty string or null removes the field. The base project has no folder and cannot be changed.
   */
  "projects.update": {
    params: z
      .object({
        project: Id,
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        kind: ProjectKind.nullable().optional(),
        /** How far agents without one of their own go here; null = auto. Kept by APX, not in the folder. */
        autonomy: Autonomy.nullable().optional(),
        /** Replaces the folders its agents may only read: absolute (or "~/…"), existing, outside APX's home. */
        read_only_folders: z.array(z.string().trim().min(1).max(1024)).max(20).optional(),
      })
      .strict(),
    result: z.object({ project: Project }),
    effect: true,
    access: "human",
  },
  /** Optional, owner-only review of existing context; never changes an agent definition. */
  "projects.helper_review": {
    params: z
      .object({
        project: Id,
        manual: z.boolean().default(false),
        draft: z
          .object({ role: z.string().max(500), prompt: z.string().max(100_000) })
          .strict()
          .optional(),
      })
      .strict(),
    result: z.object({
      enabled: z.boolean(),
      offer: z.boolean(),
      fingerprint: z.string(),
      missing: z.array(z.enum(["goal", "first_result", "role", "instructions"])),
      agent_gaps: z.array(z.object({ id: Id, name: z.string(), missing: z.array(z.enum(["role", "instructions"])) })),
      goal: z.string(),
      first_result: z.string(),
      brief: z.string(),
      recipient: Id.optional(),
      suggested_prompt: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
  "projects.helper_set": {
    params: z
      .object({
        project: Id,
        enabled: z.boolean().optional(),
        goal: z.string().trim().max(2000).optional(),
        first_result: z.string().trim().max(2000).optional(),
        dismissed: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Reads the project's files again (all projects when `project` is absent). */
  "projects.sync": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ projects: z.number().int(), agents: z.number().int(), archived: z.number().int() }),
    effect: true,
  },
  /** Removes a folder from the registry; its files and existing conversations remain available. */
  "projects.unregister": {
    params: z.object({ project: Id }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "threads.list": {
    params: z
      .object({
        project_id: Id.optional(),
        /** All delegated descendants of this chat, without the global list cap. */
        root_thread: Id.optional(),
        include_subthreads: z.boolean().default(false),
        /**
         * With each listed chat, up to this many of the chats delegated from it (newest first, outside the cap); and
         * the chats delegated into another project than their caller's, which that project lists too.
         */
        delegated: z.number().int().min(0).max(50).default(0),
        /** Archived threads too (they are left out by default). */
        include_archived: z.boolean().default(false),
        /** Only that engine's own sessions ("claude", "codex", "acp:opencode"), not agents' chats run on its model. */
        engine: z.string().max(80).optional(),
      })
      .strict(),
    result: z.object({
      threads: z.array(Thread),
      /** With `delegated`: how many chats (not archived) each listed chat delegated, for the ones that did. */
      delegated: z.record(z.string(), z.number().int().nonnegative()).optional(),
    }),
    effect: false,
  },
  "threads.get": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ thread: Thread, messages: z.array(Message), runs: z.array(Run) }),
    effect: false,
  },
  "threads.create": {
    params: z
      .object({
        kind: z.enum(["agent", "loose", "code"]),
        agent_id: Id,
        title: z.string().max(200).optional(),
        project_id: Id.optional(),
        /** Code threads: a folder inside the project (relative, or absolute under it); default the project's root. */
        cwd: z.string().max(1024).optional(),
        write: WritePolicy.optional(),
        /** A code thread with an outside engine itself ("claude", "codex", "acp:opencode"): its own prompt, no persona. */
        engine: z
          .string()
          .regex(/^(claude|codex|aider|antigravity|acp:[a-z0-9][a-z0-9-]*)$/)
          .optional(),
      })
      .strict(),
    result: Thread,
    effect: true,
  },
  /**
   * The one way to talk to an agent. The message and its run are stored before this returns, so a restart does not
   * lose them; the run streams as events. `interrupt` cancels the turn in progress first; `queue` waits for it.
   */
  "threads.send": {
    params: z
      .object({
        thread: Id,
        text: z.string().min(1).max(50_000),
        /**
         * queue: after what is running. interrupt: stop the running turn, then this. steer: into the running turn
         * at its next step (APX's own loop); when nothing can take it, it queues.
         */
        mode: z.enum(["queue", "interrupt", "steer"]).default("queue"),
        /** Owner-only: continue this stopped delegated run, only if it is still the session's latest run. */
        continue_run: Id.optional(),
        /** Files and images uploaded with media.upload, shown with the message and read by the agent. */
        attachments: z.array(Id).max(8).optional(),
      })
      .strict(),
    /** `steered`: the text went into the running turn `run` instead of starting a new one. */
    result: z.object({ message: Message, run: Run, steered: z.boolean().optional() }),
    effect: true,
  },
  /** Running work plus the most recently finished, newest first (the background view). */
  /** With `thread`: that chat's commands only (the agent's terminal), running and finished, newest first. */
  "jobs.list": {
    params: z.object({ finished: z.number().int().min(0).max(100).default(30), thread: Id.optional() }).strict(),
    result: z.object({ running: z.array(Job), finished: z.array(Job) }),
    effect: false,
  },
  /** What agents are waiting on from the owner (confirmations, questions), oldest first. */
  "runs.pending": {
    params: z.object({ thread: Id.optional() }).strict(),
    result: z.object({ inputs: z.array(PendingInput) }),
    effect: false,
  },
  /**
   * The owner's answer to a pending input: approve/deny for a confirmation, text (or one of its options) for a
   * question. Only the owner answers; an expired input refuses the answer.
   */
  "runs.respond": {
    params: z
      .object({
        input: Id,
        decision: z.enum(["approve", "deny"]).optional(),
        scope: ApprovalScope.optional(),
        text: z.string().max(4000).optional(),
      })
      .strict(),
    result: PendingInput,
    effect: true,
    access: "human",
  },
  /** One job; for a terminal job, the end of its output (or a page of it from `offset`). */
  "jobs.get": {
    params: z
      .object({
        job: Id,
        offset: z.number().int().min(0).optional(),
        max_chars: z.number().int().min(100).max(100_000).default(8000),
      })
      .strict(),
    result: z.object({ job: Job, output: z.string(), size: z.number().int(), offset: z.number().int() }),
    effect: false,
  },
  /** Stops a job: a terminal command is killed; an agent's run is canceled with what it delegated. */
  "jobs.cancel": {
    params: z.object({ job: Id }).strict(),
    result: z.object({ canceled: z.boolean() }),
    effect: true,
  },
  /** Whether the ChatGPT plan is signed in for APX's own loop, and a sign-in in progress. */
  "chatgpt.status": {
    params: z.object({}).strict(),
    result: ChatgptStatus,
    effect: false,
    access: "human",
  },
  /**
   * Signs the plan in: `device` gives a code to type at OpenAI's address (the core waits for it); `v1` takes over
   * APX v1's own sign-in. Never Codex CLI's.
   */
  "chatgpt.connect": {
    params: z.object({ via: z.enum(["device", "v1"]) }).strict(),
    result: ChatgptStatus,
    effect: true,
    access: "human",
  },
  "chatgpt.disconnect": {
    params: z.object({}).strict(),
    result: ChatgptStatus,
    effect: true,
    access: "human",
  },
  "providers.list": {
    params: z.object({}).strict(),
    result: z.object({ providers: z.array(ProviderInfo) }),
    effect: false,
    access: "human",
  },
  /**
   * Adds or changes a model API (null removes it). `api_key` is stored as a secret named after the provider and
   * never returned; `needs_key: false` is for local servers.
   */
  "providers.set": {
    params: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
        provider: z
          .object({
            label: z.string().max(60).optional(),
            preset: z.string().max(32).optional(),
            transport: ProviderTransport,
            base_url: z.string().url(),
            models: z.array(z.string().min(1)).max(200).optional(),
            enabled: z.boolean().optional(),
            needs_key: z.boolean().optional(),
          })
          .strict()
          .nullable(),
        api_key: z.string().min(1).max(4000).optional(),
      })
      .strict(),
    result: z.object({ providers: z.array(ProviderInfo) }),
    effect: true,
    access: "human",
  },
  /**
   * Tokens and turns by model since a date. `billing`: included = the owner's subscription (Claude Code, Codex, an
   * ACP agent); metered = a provider's API, paid per token. `aux`: the auxiliary model's calls outside any turn
   * (always metered). With `thread`, only that chat's, all it kept.
   */
  "usage.summary": {
    params: z.object({ since: z.string().optional(), project: Id.optional(), thread: Id.optional() }).strict(),
    result: z.object({
      since: z.string(),
      models: z.array(
        z.object({
          model: z.string(),
          billing: z.enum(["included", "metered"]),
          runs: z.number().int(),
          input: z.number().int(),
          output: z.number().int(),
        }),
      ),
      aux: z.array(
        z.object({
          purpose: AuxPurpose,
          model: z.string(),
          calls: z.number().int(),
          input: z.number().int(),
          output: z.number().int(),
        }),
      ),
    }),
    effect: false,
  },
  /**
   * Notes agents keep between threads. With `query`, the best matches first (full-text, accents ignored). An agent
   * sees the owner's global notes, its thread's project notes and its own.
   */
  "memory.list": {
    params: z
      .object({
        query: z.string().max(500).optional(),
        scope: MemoryScope.optional(),
        project: Id.optional(),
        agent: Id.optional(),
        /** Only the notes waiting for the owner to confirm them (true), or only the ones that stand (false). */
        pending: z.boolean().optional(),
        /** The forgotten notes instead (the owner's only). */
        forgotten: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .strict(),
    result: z.object({ memories: z.array(Memory) }),
    effect: false,
  },
  /** Who the owner is, for their agents (name, about, language, time zone). */
  "owner.get": {
    params: z.object({}).strict(),
    result: OwnerIdentity,
    effect: false,
    access: "human",
  },
  "owner.set": {
    params: OwnerIdentity.partial().strict(),
    result: OwnerIdentity,
    effect: true,
    access: "human",
  },
  "memory.settings": {
    params: z.object({}).strict(),
    result: MemorySettings.extend({
      indexed: z.number().int(),
      total: z.number().int(),
      /** The embedding engine and model in use ("Ollama · bge-m3"), when one is set up. */
      embedder: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
  "memory.set_settings": {
    params: MemorySettings.strict(),
    result: MemorySettings,
    effect: true,
    access: "human",
  },
  /** Indexes, by meaning, the notes not indexed yet with the current embedding engine. */
  "memory.reindex": {
    params: z.object({}).strict(),
    result: z.object({ indexed: z.number().int(), total: z.number().int(), engine: z.string().optional() }),
    effect: true,
    access: "human",
  },
  "memory.maintenance": {
    params: z.object({ backfill: z.boolean().optional(), dream: z.boolean().optional() }).strict(),
    result: z.object({ queued: z.number().int(), jobs: MemoryJobs }),
    effect: true,
    access: "human",
  },
  "memory.history": {
    params: z.object({ id: Id }).strict(),
    result: z.object({
      versions: z.array(z.object({ revision: z.number().int(), note: Memory, reason: z.string(), at: z.string() })),
    }),
    effect: false,
    access: "human",
  },
  "memory.undo": {
    params: z
      .object({
        id: Id,
        revision: z.number().int().positive(),
        expected_revision: z.number().int().positive().optional(),
      })
      .strict(),
    result: Memory,
    effect: true,
    access: "human",
  },
  "memory.consolidate": {
    params: z
      .object({
        notes: z
          .array(z.object({ id: Id, revision: z.number().int().positive() }))
          .min(2)
          .max(8),
      })
      .strict(),
    result: z.object({ merged: z.boolean() }),
    effect: true,
  },
  /**
   * An agent tidies its own notebook: retires notes a newer one corrects (`by`) or that went stale, and rewrites
   * relative dates ("today") as the dates they meant. Refused when it would forget too many notes at once.
   */
  "memory.tidy": {
    params: z
      .object({
        retire: z
          .array(
            z.object({
              id: Id,
              revision: z.number().int().positive(),
              by: Id.optional(),
              by_revision: z.number().int().positive().optional(),
            }),
          )
          .max(8)
          .optional(),
        redate: z
          .array(z.object({ id: Id, revision: z.number().int().positive() }))
          .max(32)
          .optional(),
      })
      .strict(),
    result: z.object({ retired: z.number().int(), redated: z.number().int() }),
    effect: true,
  },
  /** An agent's note goes to its own thread's project (`project`) or to itself (`agent`); `id` edits one in place. */
  "memory.add": {
    params: z
      .object({
        text: z.string().trim().min(1).max(2000),
        scope: MemoryScope,
        project: Id.optional(),
        agent: Id.optional(),
        id: Id.optional(),
        kind: Memory.shape.kind,
        evidence: z.array(MemoryEvidence).max(8).optional(),
        expected_revision: z.number().int().positive().optional(),
        /** Set by an agent's tool when outside content is in its turn (agents' notes default to tainted). */
        tainted: z.boolean().optional(),
      })
      .strict(),
    result: Memory,
    effect: true,
  },
  /**
   * Forgets a note: out of every turn and search until the owner brings it back. An agent may forget only notes agents
   * wrote that it can see; the owner forgets any, and with `forever` deletes it for good.
   */
  "memory.remove": {
    params: z.object({ id: Id, forever: z.boolean().optional() }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
  },
  /** The owner confirms a note an agent wrote about them, so it stands in every agent's turns. */
  "memory.confirm": {
    params: z.object({ id: Id }).strict(),
    result: Memory,
    effect: true,
    access: "human",
  },
  /** Brings a forgotten note back. */
  "memory.restore": {
    params: z.object({ id: Id }).strict(),
    result: Memory,
    effect: true,
    access: "human",
  },
  /** The owner's channels (Telegram bots…), their settings and whether each is running. */
  "channels.list": {
    params: z.object({}).strict(),
    result: z.object({ channels: z.array(ChannelInfo) }),
    effect: false,
    access: "human",
  },
  /**
   * The channels as an agent sees them: each app APX talks through, whether it is up, and the rooms (shared places such
   * as a Discord #channel) it reads. No tokens, accounts or QR. Open to agents; people are in `contacts.list`.
   */
  "channels.overview": {
    params: z.object({}).strict(),
    result: z.object({
      channels: z.array(
        z.object({
          id: z.string(),
          type: ChannelType,
          label: z.string(),
          status: ChannelInfo.shape.status,
          rooms: z.array(z.object({ name: z.string(), mode: RoomMode })),
        }),
      ),
    }),
    effect: false,
  },
  /**
   * Adds, changes or (null) removes a channel. `token` goes to the secret store and never comes back; the channel is
   * restarted with the new settings.
   */
  "channels.set": {
    params: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
        channel: z
          .object({
            type: ChannelType,
            label: z.string().max(60).optional(),
            enabled: z.boolean().default(true),
            agent_id: Id,
            strangers: ChannelStrangers.default("pair"),
            concurrency: z.enum(["queue", "interrupt", "steer"]).default("steer"),
            owner_thread: z.enum(["home", "own"]).default("home"),
            self_owner: z.boolean().optional(),
            rooms: ChannelRooms.optional(),
            closers: ChannelClosers.default("silent"),
            research: ChannelResearch.default("owner"),
            email: ChannelEmail.optional(),
          })
          .nullable(),
        token: z.string().min(8).max(400).optional(),
      })
      .strict(),
    result: z.object({ channels: z.array(ChannelInfo) }),
    effect: true,
    access: "human",
  },
  /**
   * The owner writes to a contact or a room themselves, in its chat ("I'll write"): sent as is on the channel (in a
   * room, through the bot's account, the room's people named as @handle mentioned) and kept in the chat.
   */
  "channels.send": {
    params: z.object({ thread: Id, text: z.string().trim().min(1).max(4000) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /**
   * An agent writes to one of the owner's contacts (or to the owner, on a channel) for the owner ("tell Alex on
   * WhatsApp…", "send me the quote"): sent on
   * the contact's channel (the one given, else the one they talked on last) and kept in their chat, where their answer
   * arrives. `recent` is the end of that chat, so the agent knows what was already said. Never offered to a contact's
   * own turn.
   */
  "channels.message": {
    params: z
      .object({
        person: Id,
        text: z.string().trim().min(1).max(4000),
        /** A channel id or type ("whatsapp"); absent: the one the contact used last. */
        channel: z.string().max(60).optional(),
        /** Files to send with it (media ids): images as images, anything else as a document. */
        files: z.array(Id).max(5).optional(),
      })
      .strict(),
    result: Sent,
    effect: true,
  },
  /**
   * An agent posts in a public room for the owner (a Discord server's channel the owner listed: "post the summary in
   * #help"): kept in the room's chat and sent with no pings to everyone. `room` is its exact name, with or without "#".
   * Never offered to a contact's own turn.
   */
  "channels.post": {
    params: z
      .object({
        room: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(4000),
        /** A channel id or type ("discord"), for two rooms of the same name on different channels. */
        channel: z.string().max(60).optional(),
        /** Files to send with it (media ids): images as images, anything else as a document. */
        files: z.array(Id).max(5).optional(),
      })
      .strict(),
    result: Sent,
    effect: true,
  },
  /** What channels sent lately and how each delivery went (sent, uncertain, failed). */
  "channels.outbox": {
    params: z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
    result: z.object({ items: z.array(OutboxItem) }),
    effect: false,
    access: "human",
  },
  /**
   * A contact's chat on a channel, to write to them from the app: the one they have, or a new empty one (nothing is
   * sent until someone writes in it).
   */
  "channels.open": {
    params: z.object({ person: Id, channel: z.string().min(1).max(60) }).strict(),
    result: Thread,
    effect: true,
    access: "human",
  },
  /**
   * The rooms of the servers a channel's bot is in (Discord's text and announcement channels), or the groups a Telegram
   * bot was seen in (the Bot API cannot list them), to add one by picking it; `writable`: whether the bot may post there
   * (Discord's permissions for its roles in that room; always true for a Telegram group).
   */
  "channels.rooms": {
    params: z.object({ channel: z.string().min(1).max(60) }).strict(),
    result: z.object({
      rooms: z.array(z.object({ id: z.string(), name: z.string(), server: z.string(), writable: z.boolean() })),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Who of a channel's contacts is online, as far as the platform says (WhatsApp; those who hide it never show).
   * Asking starts listening for them, so the first answer may be empty.
   */
  "channels.presence": {
    params: z.object({ channel: z.string().min(1).max(60) }).strict(),
    result: z.object({
      people: z.array(z.object({ person_id: Id, online: z.boolean(), last_seen: z.string().optional() })),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Files that never arrived in a channel chat (kept as "[video — APX cannot read…]" or "[attachment could not be
   * downloaded…]") asked of the platform again — on WhatsApp the owner's phone sends each message again, so it has to
   * be online — and put in their messages. Starts no turn. `missing` says why each one did not come.
   */
  "channels.recover": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({
      /** Messages waiting for their file. */
      asked: z.number().int(),
      recovered: z.array(z.object({ message_id: z.string(), name: z.string() })),
      missing: z.array(z.object({ message_id: z.string(), reason: z.string() })),
      /** Why nothing was tried, or why nothing came. */
      reason: z.string().optional(),
    }),
    effect: true,
    access: "human",
  },
  /** iMessage on this Mac as agent tools (read recent messages, send one with the owner's OK); off until turned on. */
  "imessage.get": {
    params: z.object({}).strict(),
    result: z.object({ available: z.boolean(), on: z.boolean() }),
    effect: false,
    access: "human",
  },
  "imessage.set": {
    params: z.object({ on: z.boolean() }).strict(),
    result: z.object({ available: z.boolean(), on: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** The desktop app's settings: the global shortcut of the quick chat and whether APX starts at login. */
  /** The desktop app's settings: quick chat shortcut, start at login, and computer use on this computer. */
  "desktop.get": {
    params: z.object({}).strict(),
    result: z.object({ shortcut: z.string(), launch_at_login: z.boolean(), computer_use: z.boolean() }),
    effect: false,
    access: "human",
  },
  "desktop.set": {
    params: z
      .object({ shortcut: z.string().max(60), launch_at_login: z.boolean(), computer_use: z.boolean().default(false) })
      .strict(),
    result: z.object({ shortcut: z.string(), launch_at_login: z.boolean(), computer_use: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Image and voice services in the owner's order, with whether each answers now; and the shared image defaults. */
  "services.list": {
    params: z.object({ kind: ServiceKind.optional() }).strict(),
    result: z.object({ services: z.array(ServiceInfo), image_defaults: ImageDefaults }),
    effect: false,
    access: "human",
  },
  /** Adds, changes or (null) removes a service; `api_key` goes to the secret store and never comes back. */
  "services.set": {
    params: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
        service: ServiceSettings.nullable(),
        api_key: z.string().min(1).max(4000).optional(),
      })
      .strict(),
    result: z.object({ services: z.array(ServiceInfo) }),
    effect: true,
    access: "human",
  },
  /**
   * Asks a service now, saved or not yet (`service` as the form has it): whether it answers and the models it offers.
   * `id` names a saved one, whose key is used when `api_key` is not given and whose status is updated.
   */
  "services.test": {
    params: z
      .object({
        service: ServiceSettings,
        id: z.string().max(32).optional(),
        api_key: z.string().min(1).max(4000).optional(),
      })
      .strict(),
    result: ServiceTest,
    effect: false,
    access: "human",
  },
  /** Local transcription: this machine, the model that fits it, the models on disk and a download in progress. */
  "transcription.local": {
    params: z.object({}).strict(),
    result: LocalTranscription,
    effect: false,
    access: "human",
  },
  /**
   * Gets a local model (downloaded now, in the background) and sets up the local transcription service with it, first
   * in the order; one already on disk is only set up.
   */
  "transcription.install": {
    params: z.object({ model: z.string().max(60) }).strict(),
    result: LocalTranscription,
    effect: true,
    access: "human",
  },
  /** Embeddings on this machine through Ollama: whether it runs here, its models, the one that fits, a pull. */
  "embeddings.local": {
    params: z.object({}).strict(),
    result: LocalEmbedding,
    effect: false,
    access: "human",
  },
  /**
   * Sets memory's embedding engine to Ollama here with `model`, first in the order; a model Ollama does not have yet is
   * pulled first, in the background.
   */
  "embeddings.install": {
    params: z.object({ model: z.string().regex(/^[\w.:/-]{1,80}$/) }).strict(),
    result: LocalEmbedding,
    effect: true,
    access: "human",
  },
  /** The order services of one kind are tried in. */
  "services.order": {
    params: z.object({ kind: ServiceKind, ids: z.array(z.string()).max(50) }).strict(),
    result: z.object({ services: z.array(ServiceInfo) }),
    effect: true,
    access: "human",
  },
  "services.defaults": {
    params: ImageDefaults.strict(),
    result: ImageDefaults,
    effect: true,
    access: "human",
  },
  /**
   * Draws an image with the first image service that answers (or `service`). With `thread`, the images are shown in
   * that chat. Agents call it through make_image.
   */
  "media.image": {
    params: z
      .object({
        prompt: z.string().trim().min(1).max(4000),
        service: z.string().optional(),
        width: z.number().int().min(64).max(4096).optional(),
        height: z.number().int().min(64).max(4096).optional(),
        steps: z.number().int().min(1).max(200).optional(),
        negative_prompt: z.string().max(2000).optional(),
        count: z.number().int().min(1).max(4).optional(),
        seed: z.number().int().optional(),
        /** Images (media ids, from this chat when `thread` is given) the drawing works from. */
        references: z.array(Id).max(4).optional(),
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({
      media: z.array(z.object({ id: Id, mime: z.string() })),
      service: z.string(),
      model: z.string().optional(),
      /** Services tried before this one, and why each failed. */
      skipped: z.array(z.string()),
    }),
    effect: true,
  },
  /** Speaks text with the first voice service that answers (or `service`). */
  "media.speak": {
    params: z
      .object({
        text: z.string().trim().min(1).max(4000),
        service: z.string().optional(),
        voice: z.string().max(100).optional(),
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({
      media: z.object({ id: Id, mime: z.string() }),
      service: z.string(),
      skipped: z.array(z.string()),
    }),
    effect: true,
  },
  /** The bytes of an image or audio APX made, base64. */
  "media.get": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ mime: z.string(), data: z.string(), bytes: z.number().int() }),
    effect: false,
  },
  "notices.get": {
    params: z.object({}).strict(),
    result: NoticePrefs,
    effect: false,
    access: "human",
  },
  /** The latest messages APX meant to send unasked (newest first), and how many count today against the cap. */
  "notices.log": {
    params: z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
    result: z.object({ items: z.array(Nudge), today: z.object({ sent: z.number().int(), cap: z.number().int() }) }),
    effect: false,
    access: "human",
  },
  /** The owner's 👍/👎 on a message APX sent unasked (null takes it back). A kind marked 👎 again and again stops. */
  "notices.feedback": {
    params: z.object({ id: Id, feedback: z.enum(["up", "down"]).nullable() }).strict(),
    result: Nudge,
    effect: true,
    access: "human",
  },
  "notices.set": {
    params: NoticePrefs.strict(),
    result: NoticePrefs,
    effect: true,
    access: "human",
  },
  "contacts.list": {
    params: z.object({}).strict(),
    result: z.object({ persons: z.array(Person) }),
    effect: false,
    access: "human",
  },
  /** Creates (no id) or changes a person; the owner stays the owner. */
  "contacts.set": {
    params: z
      .object({
        id: Id.optional(),
        name: z.string().trim().min(1).max(80),
        role: PersonRole.optional(),
        note: z.string().max(500).optional(),
        nickname: z.string().trim().max(40).optional(),
        relation: PersonRelation.nullable().optional(),
        rules: z.string().max(1000).optional(),
        muted: z.boolean().optional(),
        supervised: z.boolean().optional(),
        // Only the flags sent change (PersonPerms' defaults would reset the others).
        perms: z
          .object({ appointments: z.boolean(), requests: z.boolean(), notes: z.boolean() })
          .partial()
          .strict()
          .optional(),
      })
      .strict(),
    result: Person,
    effect: true,
    access: "human",
  },
  /** Replies drafted for supervised contacts, newest first: the pending ones by default. */
  "contacts.suggestions.list": {
    params: z
      .object({
        state: z.enum(["pending", "sent", "discarded", "superseded", "all"]).default("pending"),
        person: Id.optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .strict(),
    result: z.object({ suggestions: z.array(ContactSuggestion) }),
    effect: false,
    access: "human",
  },
  /**
   * Sends a pending suggestion to the contact in their chat, as the agent's reply; `text` sends that instead (edited).
   * `author: "owner"` sends `text` as the owner's own words. `delivery`: how the send went, as channels.message says.
   */
  "contacts.suggestions.send": {
    params: z
      .object({
        id: Id,
        text: z.string().trim().min(1).max(4000).optional(),
        author: z.enum(["agent", "owner"]).default("agent"),
      })
      .strict(),
    result: z.object({
      suggestion: ContactSuggestion,
      delivery: z.object({ state: OutboxState, error: z.string().optional() }),
    }),
    effect: true,
    access: "human",
  },
  /** Drops a pending suggestion: nothing is sent, the contact stays supervised. */
  "contacts.suggestions.discard": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ suggestion: ContactSuggestion }),
    effect: true,
    access: "human",
  },
  /** Removes a person (never the owner) with their addresses, or only one address. */
  "contacts.remove": {
    params: z.object({ id: Id.optional(), address: Id.optional() }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  /**
   * "This account is mine": an address approved as a contact's becomes the owner's (their chats on that channel
   * too); a contact left with no address is removed.
   */
  /**
   * Links an address the owner types (a phone number on WhatsApp, a chat id on Telegram) to a person, the owner by
   * default: whoever writes from it is that person from then on.
   */
  "contacts.address": {
    params: z
      .object({
        channel: z.string().min(1).max(32),
        address: z.string().trim().min(3).max(80),
        person: Id.optional(),
      })
      .strict(),
    result: Person,
    effect: true,
    access: "human",
  },
  /** A person's profile picture on their channel (WhatsApp, Telegram), as media to fetch; none when hidden. */
  "contacts.avatar": {
    params: z.object({ person: Id }).strict(),
    result: z.object({ media_id: Id.optional() }),
    effect: false,
    access: "human",
  },
  "contacts.claim": {
    params: z.object({ address: Id }).strict(),
    result: z.object({ moved: z.boolean() }),
    effect: true,
    access: "human",
  },
  /**
   * The owner's own Claude Code or Codex sessions on this machine (read from ~/.claude, ~/.codex), newest first;
   * those APX already goes on with are left out (they are its chats).
   */
  "sessions.native": {
    params: z
      .object({ engine: z.enum(["claude", "codex"]), limit: z.number().int().min(1).max(300).optional() })
      .strict(),
    result: z.object({
      sessions: z.array(z.object({ id: z.string(), title: z.string(), cwd: z.string(), updated_at: z.string() })),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Goes on with one of those sessions in APX: a chat with that engine itself, in the session's folder, with what was
   * said there; the engine picks up its own session. Again: the chat it already has.
   */
  "sessions.resume": {
    params: z.object({ engine: z.enum(["claude", "codex"]), id: z.string().min(1).max(120) }).strict(),
    result: Thread,
    effect: true,
    access: "human",
  },
  /**
   * The engine's work on this machine grouped by project (Codex's own projects, else the folders sessions ran in),
   * newest first; `project_id` when APX already has that folder, `thread` for a session already brought in.
   */
  "sessions.projects": {
    params: z.object({ engine: z.enum(["claude", "codex"]) }).strict(),
    result: z.object({
      projects: z.array(
        z.object({
          name: z.string(),
          cwd: z.string(),
          project_id: Id.optional(),
          sessions: z.array(
            z.object({ id: z.string(), title: z.string(), updated_at: z.string(), thread: Id.optional() }),
          ),
        }),
      ),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Brings a project's sessions (all, or `sessions`) into APX: the folder becomes a project if it is not one, each
   * session a chat with its whole history, images, artifacts (as widgets) and documents, answered by the project's
   * orchestrator (else the super-agent) until an agent of its area takes it (sessions.adopt). Again: only what is new.
   * `pages` are the HTML files those sessions wrote (surfaces.import_page).
   */
  "sessions.import": {
    params: z
      .object({
        engine: z.enum(["claude", "codex"]),
        cwd: z.string().min(1).max(1000),
        sessions: z.array(z.string().min(1).max(120)).max(500).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        /**
         * The project's MCP servers, memory notes, open tasks and automations too (default). Servers whose file holds
         * a credential are only listed (`need_values`); automations come as routines turned off.
         */
        extras: z.boolean().default(true),
      })
      .strict(),
    result: z.object({
      project: z.object({ id: Id, name: z.string() }),
      extras: z
        .object({
          mcps: z.object({
            added: z.array(z.string()),
            existing: z.array(z.string()),
            need_values: z.array(z.object({ name: z.string(), keys: z.array(z.string()) })),
          }),
          notes: z.number().int(),
          tasks: z.number().int(),
          routines: z.array(z.string()),
          /** What APX refused, with why (a note that reads as a credential); the next import tries it again. */
          skipped: z.array(z.string()),
        })
        .optional(),
      chats: z.array(
        z.object({
          thread: Id,
          session: z.string(),
          title: z.string(),
          added: z.number().int(),
          created: z.boolean(),
        }),
      ),
      pages: z.array(z.string()),
    }),
    effect: true,
    access: "human",
  },
  /**
   * What an imported chat is about, for the agent that takes it over: the owner's opening framing word for word, then
   * its role, recurring tasks, formats, preferences, facts, open work. Written once by the auxiliary model; `refresh`
   * writes it again.
   */
  "sessions.digest": {
    params: z.object({ thread: Id, refresh: z.boolean().optional() }).strict(),
    result: z.object({ thread: Id, title: z.string(), digest: z.string(), at: z.string() }),
    effect: true,
    access: "human",
  },
  /** An agent takes an imported chat over: it answers there from now on, and the earlier answers show as its own. */
  "sessions.adopt": {
    params: z.object({ thread: Id, agent: z.string().min(1).max(120) }).strict(),
    result: Thread,
    effect: true,
    access: "human",
  },
  "pairing.list": {
    params: z.object({}).strict(),
    result: z.object({ requests: z.array(PairingRequest) }),
    effect: false,
    access: "human",
  },
  /**
   * Approves a stranger's code: as the owner (this address is you), as a new contact (`name`), or as another address
   * of an existing person (`person`). `deny` drops it.
   */
  "pairing.respond": {
    params: z
      .object({
        code: z.string().min(4).max(12),
        decision: z.enum(["owner", "contact", "deny"]),
        person: Id.optional(),
        name: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    result: z.object({ person: Person.optional() }),
    effect: true,
    access: "human",
  },
  /** An agent's runs, newest first (its activity), with the title and kind of each run's thread. */
  "runs.list": {
    params: z
      .object({ agent: Id, limit: z.number().int().min(1).max(100).default(30), before: z.string().max(40).optional() })
      .strict(),
    result: z.object({
      runs: z.array(Run),
      threads: z.array(z.object({ id: Id, title: z.string(), kind: z.string() })),
    }),
    effect: false,
    access: "human",
  },
  "runs.get": {
    params: z.object({ run: Id }).strict(),
    result: Run,
    effect: false,
  },
  /** Waits until the run ends or `timeout_s` passes, and returns it as it is then. */
  "runs.wait": {
    params: z.object({ run: Id, timeout_s: z.number().int().min(1).max(600).default(60) }).strict(),
    result: Run,
    effect: false,
  },
  /** Whether this chat's answers on a channel also go as voice notes. An agent changes only its own thread. */
  "threads.voice": {
    params: z.object({ thread: Id, on: z.boolean() }).strict(),
    result: z.object({ on: z.boolean() }),
    effect: true,
  },
  "threads.cancel": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ canceled: z.number().int() }),
    effect: true,
  },
  /**
   * Lets agents go on in the conversation tree `thread` is in, after the breaker paused it: `reset` gives them a fresh
   * budget from now, `release` no limit until the owner writes there again. Tasks given while paused start, and chats
   * that kept a result go on. `started`: the turns that began.
   */
  "threads.go_on": {
    params: z.object({ thread: Id, mode: z.enum(["reset", "release"]) }).strict(),
    result: z.object({ started: z.number().int() }),
    effect: true,
    access: "human",
  },
  /**
   * Summarizes the thread's older turns now (APX's own loop sees the summary plus the newest turns verbatim). Claude
   * Code and Codex keep and compact their own transcript.
   */
  "threads.compact": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ compacted: z.boolean(), reason: z.string().optional() }),
    effect: true,
    access: "human",
  },
  /** The owner saw the thread: its unread count and its notices (not pending questions) are cleared. */
  /** Messages whose text has every word typed (each also as a prefix), best first: for the search box. */
  "threads.search": {
    params: z
      .object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) })
      .strict(),
    result: z.object({
      hits: z.array(
        z.object({
          thread_id: Id,
          message_id: Id,
          seq: z.number().int(),
          author: Author,
          snippet: z.string(),
          created_at: z.string(),
        }),
      ),
    }),
    effect: false,
    access: "human",
  },
  "threads.read": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Every widget, or with `project_id` only that project's (the global ones are listed without it). */
  "surfaces.list": {
    params: z.object({ project_id: Id.optional() }).strict(),
    result: z.object({ surfaces: z.array(SurfaceSummary) }),
    effect: false,
  },
  "surfaces.get": {
    params: z.object({ surface: Id }).strict(),
    result: Surface,
    effect: false,
  },
  /**
   * A media file a widget shows (an image, video or audio, up to 15 MB), read-only and scoped to the widget's project:
   * `ref` is a path in the project's folder (the base project's for a global widget) or `media:<id>` for a file APX
   * stored in one of that project's chats. Only refs written in the widget's own HTML resolve.
   */
  "surfaces.media": {
    params: z.object({ surface: Id, ref: z.string().trim().min(1).max(1000) }).strict(),
    result: z.object({ mime: z.string(), data: z.string(), bytes: z.number().int() }),
    effect: false,
    access: "human",
  },
  /**
   * Creates or updates a widget by its stable name (per project). Called by an agent, it lands in the agent's thread;
   * `thread` places it elsewhere.
   */
  "surfaces.show": {
    params: z
      .object({
        name: z
          .string()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9][a-z0-9-]*$/),
        title: z.string().min(1).max(120),
        html: z.string().min(1).max(400_000),
        pinned: z.boolean().optional(),
        app: z.boolean().optional(),
        /** Origins it may read live data from ([] removes them; absent keeps the current ones). */
        connect: z.array(SurfaceOrigin).max(5).optional(),
        thread: Id.optional(),
        /** Without a thread (`apx artifacts push`): the project it belongs to; none makes it global. */
        project: Id.optional(),
      })
      .strict(),
    result: SurfaceSummary,
    effect: true,
  },
  /**
   * Copies a widget into another project (`project_id` null: the base project), as the owner's: same title, page and
   * origins, its name kept unless that project has one by it ("-2" then). Not linked to the original afterwards.
   */
  "surfaces.copy": {
    params: z.object({ surface: Id, project_id: Id.nullable(), pinned: z.boolean().default(false) }).strict(),
    result: SurfaceSummary,
    effect: true,
    access: "human",
  },
  /**
   * An HTML page in a project's folder (one an imported session wrote) as a widget of that project: its local
   * scripts and styles inlined, its images and videos loaded from the folder (data-apx-src). Again: a new version.
   */
  "surfaces.import_page": {
    params: z
      .object({
        project_id: Id,
        path: z.string().min(1).max(1000),
        name: z
          .string()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .optional(),
        title: z.string().trim().min(1).max(120).optional(),
        pinned: z.boolean().default(true),
      })
      .strict(),
    result: SurfaceSummary,
    effect: true,
    access: "human",
  },
  "surfaces.update": {
    params: z.object({ surface: Id, pinned: z.boolean().optional(), app: z.boolean().optional() }).strict(),
    result: SurfaceSummary,
    effect: true,
  },
  /**
   * Deletes a widget for good, with what it remembers (APX.store, APX.db): the chats that showed it keep their messages.
   * Owner only.
   */
  "surfaces.remove": {
    params: z.object({ surface: Id }).strict(),
    result: z.object({ removed: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Publishes (or revokes) a surface as an artifact: a standalone page at /a/<token>, isolated from the API. */
  "surfaces.share": {
    params: z.object({ surface: Id, shared: z.boolean() }).strict(),
    result: SurfaceSummary,
    effect: true,
    access: "human",
  },
  /**
   * Changes what a widget remembers (APX.state): `patch` keys are set, a null removes one; `replace` starts from empty.
   * Refused past SURFACE_STATE_MAX characters of JSON. The page and its version stay as they are.
   */
  "surfaces.set_state": {
    params: z.object({ surface: Id, patch: SurfaceState, replace: z.boolean().optional() }).strict(),
    result: z.object({ state: SurfaceState }),
    effect: true,
  },
  /** A widget's sendPrompt(): the text goes to the thread that owns the surface, as the user. */
  "surfaces.prompt": {
    params: z.object({ surface: Id, text: z.string().min(1).max(4000) }).strict(),
    result: z.object({ thread: Id, run: Run }),
    effect: true,
  },
} as const;
