// Methods behind the app screens: agents, projects, threads, surfaces.
import { z } from "zod";
import {
  Agent,
  CatalogEngine,
  ChannelInfo,
  EngineStatus,
  Id,
  ImageDefaults,
  Job,
  McpServerStatus,
  Memory,
  MemoryScope,
  MemorySettings,
  Message,
  ModelChoice,
  NoticePrefs,
  Notification,
  OutboxItem,
  PairingRequest,
  PendingInput,
  Person,
  PersonRole,
  Project,
  ProviderInfo,
  RouterConfig,
  Routine,
  RoutineRun,
  Run,
  Schedule,
  ServiceInfo,
  ServiceKind,
  ServiceSettings,
  Surface,
  SurfaceSummary,
  Task,
  TaskColumn,
  TaskEvent,
  TaskState,
  Thread,
  WritePolicy,
} from "./domain.ts";

export const appMethods = {
  /**
   * Read-only import from a local APX v1: registers the project folders it knows (their .apc/ is read from disk)
   * and, when asked, copies once into v2's own home: its model API keys (`keys`), its skills (`skills`), and its image
   * engines and voices (`services`).
   */
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
  /** Names of the stored secrets; values never leave the core. */
  "secrets.list": {
    params: z.object({}).strict(),
    result: z.object({ secrets: z.array(z.object({ name: z.string(), updated_at: z.string() })) }),
    effect: false,
    access: "human",
  },
  "secrets.set": {
    params: z
      .object({
        name: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
        /** null removes it. */
        value: z.string().min(1).max(16_384).nullable(),
      })
      .strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "agents.list": {
    params: z.object({}).strict(),
    result: z.object({ agents: z.array(Agent) }),
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
        prompt: z.string().max(100_000).optional(),
        parent: z.string().max(64).optional(),
        blob: z.string().max(40).optional(),
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
    params: z.object({}).strict(),
    result: z.object({ projects: z.array(Project) }),
    effect: false,
  },
  /** Registers a folder as a project and reads its AGENTS.md and .apc/ (never writes them). */
  "projects.register": {
    params: z.object({ path: z.string().min(1).max(1024) }).strict(),
    result: z.object({ project: Project, agents: z.number().int() }),
    effect: true,
    access: "human",
  },
  /** Reads the project's files again (all projects when `project` is absent). */
  "projects.sync": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ projects: z.number().int(), agents: z.number().int(), archived: z.number().int() }),
    effect: true,
  },
  "threads.list": {
    params: z.object({ project_id: Id.optional(), include_subthreads: z.boolean().default(false) }).strict(),
    result: z.object({ threads: z.array(Thread) }),
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
      })
      .strict(),
    /** `steered`: the text went into the running turn `run` instead of starting a new one. */
    result: z.object({ message: Message, run: Run, steered: z.boolean().optional() }),
    effect: true,
  },
  /** Running work plus the most recently finished, newest first (the background view). */
  "jobs.list": {
    params: z.object({ finished: z.number().int().min(0).max(100).default(30) }).strict(),
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
            transport: z.enum(["openai-chat", "anthropic-messages"]),
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
  /** MCP servers: the owner's and each project's, with whether they are approved and running. */
  "mcp.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ servers: z.array(McpServerStatus) }),
    effect: false,
    access: "human",
  },
  /** Approves (or withdraws) a project's server as its file defines it now; a changed file needs approving again. */
  "mcp.trust": {
    params: z.object({ project: Id, server: z.string().min(1).max(64), trusted: z.boolean() }).strict(),
    result: z.object({ server: McpServerStatus }),
    effect: true,
    access: "human",
  },
  /** Adds, replaces or (null) removes one of the owner's own servers. Env and header values may be secret://. */
  "mcp.set": {
    params: z
      .object({
        name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
        server: z
          .object({
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string(), z.string()).optional(),
            url: z.string().url().optional(),
            headers: z.record(z.string(), z.string()).optional(),
            enabled: z.boolean().optional(),
          })
          .strict()
          .refine((s) => !!s.command !== !!s.url, "give either command or url")
          .nullable(),
      })
      .strict(),
    result: z.object({ servers: z.array(McpServerStatus) }),
    effect: true,
    access: "human",
  },
  /**
   * Tokens and turns by model since a date. `billing`: included = the owner's subscription (Claude Code, Codex, an
   * ACP agent); metered = a provider's API, paid per token.
   */
  "usage.summary": {
    params: z.object({ since: z.string().optional(), project: Id.optional() }).strict(),
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
    }),
    effect: false,
  },
  /** Skills agents can load: the owner's (APX home `skills/`) and, with `project`, that project's `.apc/skills/`. */
  "skills.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({
      skills: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          scope: z.enum(["global", "project"]),
          project_id: Id.optional(),
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
        limit: z.number().int().min(1).max(500).default(100),
      })
      .strict(),
    result: z.object({ memories: z.array(Memory) }),
    effect: false,
  },
  "memory.settings": {
    params: z.object({}).strict(),
    result: MemorySettings.extend({ indexed: z.number().int(), total: z.number().int() }),
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
  /** An agent's note goes to its own thread's project (`project`) or to itself (`agent`); `id` edits one in place. */
  "memory.add": {
    params: z
      .object({
        text: z.string().trim().min(1).max(2000),
        scope: MemoryScope,
        project: Id.optional(),
        agent: Id.optional(),
        id: Id.optional(),
        /** Set by an agent's tool when outside content is in its turn (agents' notes default to tainted). */
        tainted: z.boolean().optional(),
      })
      .strict(),
    result: Memory,
    effect: true,
  },
  /** An agent may remove only notes agents wrote that it can see; the owner removes any. */
  "memory.remove": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
  },
  /** The owner's channels (Telegram bots…), their settings and whether each is running. */
  "channels.list": {
    params: z.object({}).strict(),
    result: z.object({ channels: z.array(ChannelInfo) }),
    effect: false,
    access: "human",
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
            type: z.enum(["telegram"]),
            label: z.string().max(60).optional(),
            enabled: z.boolean().default(true),
            agent_id: Id,
            strangers: z.enum(["pair", "ignore"]).default("pair"),
            concurrency: z.enum(["queue", "interrupt", "steer"]).default("queue"),
            owner_thread: z.enum(["home", "own"]).default("home"),
          })
          .nullable(),
        token: z.string().min(8).max(400).optional(),
      })
      .strict(),
    result: z.object({ channels: z.array(ChannelInfo) }),
    effect: true,
    access: "human",
  },
  /** What channels sent lately and how each delivery went (sent, uncertain, failed). */
  "channels.outbox": {
    params: z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
    result: z.object({ items: z.array(OutboxItem) }),
    effect: false,
    access: "human",
  },
  /** The desktop app's settings: the global shortcut of the quick chat and whether APX starts at login. */
  "desktop.get": {
    params: z.object({}).strict(),
    result: z.object({ shortcut: z.string(), launch_at_login: z.boolean() }),
    effect: false,
    access: "human",
  },
  "desktop.set": {
    params: z.object({ shortcut: z.string().max(60), launch_at_login: z.boolean() }).strict(),
    result: z.object({ shortcut: z.string(), launch_at_login: z.boolean() }),
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
  /** Tasks (open by default) with the board's columns. An agent sees its own thread's project's and the global ones. */
  "tasks.list": {
    params: z
      .object({
        project: Id.optional(),
        state: TaskState.optional(),
        assignee: Id.optional(),
        /** Only commitments (tasks with a person), or one person's. */
        commitments: z.boolean().optional(),
        person: Id.optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .strict(),
    result: z.object({ tasks: z.array(Task), columns: z.array(TaskColumn) }),
    effect: false,
  },
  "tasks.get": {
    params: z.object({ task: Id }).strict(),
    result: z.object({ task: Task, events: z.array(TaskEvent) }),
    effect: false,
  },
  "tasks.create": {
    params: z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(10_000).optional(),
        project: Id.optional(),
        assignee: Id.optional(),
        status: z.string().max(40).optional(),
        parent: Id.optional(),
        due_at: z.string().max(40).optional(),
        /** A commitment: the person (id or exact name) and who owes it (default: the owner). */
        person: z.string().max(80).optional(),
        owed_by: z.enum(["owner", "person"]).optional(),
      })
      .strict(),
    result: Task,
    effect: true,
  },
  /** Changes what is given; `assignee: null` / `due_at: null` clear them. */
  "tasks.update": {
    params: z
      .object({
        task: Id,
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(10_000).optional(),
        status: z.string().max(40).optional(),
        assignee: Id.nullable().optional(),
        due_at: z.string().max(40).nullable().optional(),
        awaits_owner: z.boolean().optional(),
        person: z.string().max(80).nullable().optional(),
        owed_by: z.enum(["owner", "person"]).optional(),
      })
      .strict(),
    result: Task,
    effect: true,
  },
  /** Done, dropped, or open again. */
  "tasks.close": {
    params: z.object({ task: Id, state: TaskState, note: z.string().max(2000).optional() }).strict(),
    result: Task,
    effect: true,
  },
  /** A comment in the task's conversation; an @mentioned agent answers there. */
  "tasks.comment": {
    params: z.object({ task: Id, text: z.string().trim().min(1).max(20_000) }).strict(),
    result: z.object({ message: Message, runs: z.array(Run) }),
    effect: true,
  },
  /** Routines, all or one project's (the global ones have no project). */
  "routines.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ routines: z.array(Routine) }),
    effect: false,
    access: "human",
  },
  /** Creates (no id) or changes a routine; the next run is computed from its schedule. */
  "routines.set": {
    params: z
      .object({
        id: Id.optional(),
        name: z.string().trim().min(1).max(120),
        agent: Id,
        project: Id.optional(),
        schedule: Schedule,
        prompt: z.string().trim().min(1).max(20_000),
        enabled: z.boolean().default(true),
      })
      .strict(),
    result: Routine,
    effect: true,
    access: "human",
  },
  "routines.remove": {
    params: z.object({ routine: Id }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Runs a routine now, outside its schedule. */
  "routines.run": {
    params: z.object({ routine: Id }).strict(),
    result: RoutineRun,
    effect: true,
    access: "human",
  },
  "routines.runs": {
    params: z.object({ routine: Id, limit: z.number().int().min(1).max(200).default(20) }).strict(),
    result: z.object({ runs: z.array(RoutineRun) }),
    effect: false,
    access: "human",
  },
  /** The attention tray, newest first, with how many are unread. */
  "notifications.list": {
    params: z
      .object({
        unread_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .strict(),
    result: z.object({ notifications: z.array(Notification), unread: z.number().int() }),
    effect: false,
    access: "human",
  },
  /** Marks notices read: the given ones, or every one. */
  "notifications.read": {
    params: z.object({ ids: z.array(Id).max(200).optional() }).strict(),
    result: z.object({ unread: z.number().int() }),
    effect: true,
    access: "human",
  },
  "notices.get": {
    params: z.object({}).strict(),
    result: NoticePrefs,
    effect: false,
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
      })
      .strict(),
    result: Person,
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
  "threads.read": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
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
        thread: Id.optional(),
      })
      .strict(),
    result: SurfaceSummary,
    effect: true,
  },
  "surfaces.update": {
    params: z.object({ surface: Id, pinned: z.boolean().optional(), app: z.boolean().optional() }).strict(),
    result: SurfaceSummary,
    effect: true,
  },
  /** Publishes (or revokes) a surface as an artifact: a standalone page at /a/<token>, isolated from the API. */
  "surfaces.share": {
    params: z.object({ surface: Id, shared: z.boolean() }).strict(),
    result: SurfaceSummary,
    effect: true,
    access: "human",
  },
  /** A widget's sendPrompt(): the text goes to the thread that owns the surface, as the user. */
  "surfaces.prompt": {
    params: z.object({ surface: Id, text: z.string().min(1).max(4000) }).strict(),
    result: z.object({ thread: Id, run: Run }),
    effect: true,
  },
} as const;
