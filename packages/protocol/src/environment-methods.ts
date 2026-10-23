import { z } from "zod";
import { Id } from "./domain.ts";

/** The grant key that lets an agent use the isolated computer, for good or for one chat (DECISIONS.md#d-139). */
export const COMPUTER_GRANT = "apx:computer";

const Thread = z.object({ thread: z.string().min(1).max(100) }).strict();
const Appearance = Thread.extend({ appearance: z.enum(["light", "dark"]) }).strict();
const Range = z.object({ min: z.number(), max: z.number() });
export const ComputerResources = z.object({
  memory_gib: z.number().int().positive(),
  cpus: z.number().int().positive(),
  disk_gib: z.number().int().positive(),
});
export type ComputerResources = z.infer<typeof ComputerResources>;
export const environmentMethods = {
  "environments.status": {
    /** With `thread`, `agent` and `permitted` speak of that chat's agent instead of the computer's own chat. */
    params: z.object({ thread: z.string().min(1).max(100).optional() }).strict(),
    result: z.object({
      enabled: z.boolean(),
      ready: z.boolean(),
      control: z.enum(["agent", "human"]).optional(),
      changing: z.boolean().optional(),
      name: z.string(),
      thread: z.string().optional(),
      workspace: z.string(),
      model: z.string().optional(),
      demo: z.boolean().optional(),
      supported: z.boolean().optional(),
      phase: z
        .enum(["not_installed", "stopped", "preparing", "running", "stopping", "error", "unsupported"])
        .optional(),
      step: z.enum(["runtime", "guest", "desktop"]).optional(),
      downloaded: z.number().nonnegative().optional(),
      total: z.number().nonnegative().optional(),
      error: z.string().optional(),
      /** The agent of the chat it belongs to, and whether that agent may use it there. */
      agent: z.string().optional(),
      agent_name: z.string().optional(),
      permitted: z.boolean().optional(),
      /** What the next start gives it; `restart` when that differs from what it runs with now. */
      resources: ComputerResources.optional(),
      limits: z.object({ memory_gib: Range, cpus: Range, disk_gib: Range }).optional(),
      /** Its disk only grows: the smallest size the owner can still pick. */
      disk_min_gib: z.number().optional(),
      restart: z.boolean().optional(),
      idle_minutes: z.number().int().optional(),
      last_stop: z.object({ reason: z.enum(["owner", "agent", "idle", "memory"]), at: z.string() }).optional(),
    }),
    effect: false,
    access: "human",
  },
  /** The VM's memory, CPUs and disk for its next start, and how long it may sit idle before it is stopped. */
  "environments.configure": {
    params: ComputerResources.partial()
      .extend({ idle_minutes: z.number().int().min(0).max(1440).optional() })
      .strict(),
    result: z.object({ resources: ComputerResources, idle_minutes: z.number().int() }),
    effect: true,
    access: "human",
  },
  /** Lets one agent use the computer for good, or takes that away (with its grants for single chats). */
  "environments.permit": {
    params: z.object({ agent: Id, on: z.boolean() }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** An allowed agent starts the computer for the chat its run is in; it refuses when free memory cannot hold it. */
  "environments.start": {
    params: Thread,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
  },
  "environments.enable": {
    params: Appearance,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.control": {
    params: Thread.extend({ mode: z.enum(["agent", "human"]) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  /** The owner, or the allowed agent of the chat's own run. */
  "environments.stop": {
    params: Thread,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
  },
  "environments.appearance": {
    params: Appearance,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.bind": {
    params: Thread,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "environments.display": {
    params: Thread,
    result: z.object({ ticket: z.string(), expires_in: z.number() }),
    effect: true,
    access: "human",
    replay: false,
  },
  "environments.command": {
    params: Thread.extend({ command: z.string().min(1).max(4000) }).strict(),
    result: z.object({ code: z.number().int(), output: z.string() }),
    effect: true,
    replay: false,
  },
} as const;
