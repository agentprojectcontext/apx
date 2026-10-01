// Methods behind the app screens: agents, projects, threads, surfaces.
import { z } from "zod";
import {
  Agent,
  EngineStatus,
  HarnessId,
  Id,
  Message,
  Project,
  Run,
  Surface,
  SurfaceSummary,
  Thread,
} from "./domain.ts";

export const appMethods = {
  /** Read-only import of projects and agents from a running APX v1 daemon. */
  "system.import_v1": {
    params: z.object({}).strict(),
    result: z.object({ projects: z.number().int(), agents: z.number().int() }),
    effect: true,
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
        harness: HarnessId.nullable().optional(),
      })
      .strict(),
    result: Agent,
    effect: true,
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
  /** The human writes in a thread. Returns at once; the agent's run streams as events. */
  "threads.send": {
    params: z.object({ thread: Id, text: z.string().min(1).max(50_000) }).strict(),
    result: z.object({ message: Message, run: Run.optional() }),
    effect: true,
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
  },
  /** A widget's sendPrompt(): the text goes to the thread that owns the surface, as the user. */
  "surfaces.prompt": {
    params: z.object({ surface: Id, text: z.string().min(1).max(4000) }).strict(),
    result: z.object({ thread: Id }),
    effect: true,
  },
} as const;
