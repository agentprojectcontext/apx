// Methods behind the app screens: agents, projects, threads, surfaces.
import { z } from "zod";
import {
  Agent,
  CatalogEngine,
  EngineStatus,
  Id,
  Job,
  McpServerStatus,
  Memory,
  MemoryScope,
  Message,
  ModelChoice,
  PendingInput,
  Project,
  ProviderInfo,
  RouterConfig,
  Run,
  Surface,
  SurfaceSummary,
  Thread,
  WritePolicy,
} from "./domain.ts";

export const appMethods = {
  /**
   * Read-only import from a local APX v1: registers the project folders it knows (their .apc/ is read from disk)
   * and, when asked, copies its model API keys (`keys`) and its skills (`skills`) once into v2's own home.
   */
  "system.import_v1": {
    params: z.object({ keys: z.boolean().default(false), skills: z.boolean().default(false) }).strict(),
    result: z.object({
      projects: z.number().int(),
      agents: z.number().int(),
      keys: z.array(z.string()),
      skills: z.array(z.string()).default([]),
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
  "threads.read": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
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
