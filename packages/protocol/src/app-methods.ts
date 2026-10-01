// Methods behind the app screens: agents, projects, threads, surfaces.
import { z } from "zod";
import {
  Agent,
  CatalogEngine,
  EngineStatus,
  HarnessId,
  Id,
  Message,
  ModelChoice,
  Project,
  RouterConfig,
  Run,
  Surface,
  SurfaceSummary,
  Thread,
} from "./domain.ts";

export const appMethods = {
  /**
   * Read-only import from a local APX v1: registers the project folders it knows (their .apc/ is read from disk)
   * and, when `keys` is set, copies its model API keys once into v2's own secret store.
   */
  "system.import_v1": {
    params: z.object({ keys: z.boolean().default(false) }).strict(),
    result: z.object({ projects: z.number().int(), agents: z.number().int(), keys: z.array(z.string()) }),
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
  "agents.update": {
    params: z
      .object({
        agent: Id,
        browser_profile: z.enum(["shared", "isolated", "incognito"]).optional(),
        /** null = back to the install default. */
        model_choice: ModelChoice.nullable().optional(),
        /** Shorthand for `model_choice: { model: <engine>, router: false }` (null = install default). */
        harness: HarnessId.nullable().optional(),
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
  "engines.set_default": {
    params: z.object({ engine: HarnessId }).strict(),
    result: z.object({ engines: z.array(EngineStatus) }),
    effect: true,
    access: "human",
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
        kind: z.enum(["agent", "loose"]),
        agent_id: Id,
        title: z.string().max(200).optional(),
        project_id: Id.optional(),
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
        mode: z.enum(["queue", "interrupt"]).default("queue"),
      })
      .strict(),
    result: z.object({ message: Message, run: Run }),
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
