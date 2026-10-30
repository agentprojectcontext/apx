import { z } from "zod";
import { Id } from "./domain.ts";

/** The grant key that lets an agent use the isolated computer, for good or for one chat (DECISIONS.md#d-151). */
export const COMPUTER_GRANT = "apx:computer";

const ThreadId = z.string().min(1).max(100);
const Thread = z.object({ thread: ThreadId }).strict();
const Look = z.enum(["light", "dark"]);
/** An agent's screen: the number it got the first time it used the computer. */
const Screen = z.number().int().min(1).max(999);
const Range = z.object({ min: z.number(), max: z.number() });
export const ComputerResources = z.object({
  memory_gib: z.number().int().positive(),
  cpus: z.number().int().positive(),
  disk_gib: z.number().int().positive(),
});
export type ComputerResources = z.infer<typeof ComputerResources>;

/** One screen of the shared computer: whose it is, who holds it now, and whose hands it is in. */
export const ComputerScreen = z.object({
  screen: Screen,
  agent: z.string().optional(),
  agent_name: z.string().optional(),
  /** The chat and run holding it now; absent when it is up with no holder. */
  thread: z.string().optional(),
  /** That chat's title. */
  title: z.string().optional(),
  run: z.string().optional(),
  since: z.string().optional(),
  display: z.string(),
  control: z.enum(["agent", "human"]),
  changing: z.boolean(),
  watched: z.boolean().optional(),
});
export type ComputerScreen = z.infer<typeof ComputerScreen>;

const Ok = z.object({ ok: z.literal(true) });

/** A step the owner takes once on the computer's host before it can start, and the command for it when there is one. */
export const ComputerNeed = z.object({
  reason: z.enum(["qemu", "kvm_group", "kvm_missing", "wsl", "git", "wsl_mirrored"]),
  command: z.string().optional(),
});
export type ComputerNeed = z.infer<typeof ComputerNeed>;

/**
 * A start refused for want of free memory, the `detail` of its conflict: what is free, what the VM and the host's
 * reserve need, and the VM memory that would fit now when a smaller one would still run it.
 */
export type ComputerMemoryRefusal = {
  reason: "memory";
  free_gib: number;
  vm_gib: number;
  reserve_gib: number;
  fits_gib?: number;
  /** Only the reserve is missing: the owner may start it anyway. */
  anyway?: boolean;
};

export const environmentMethods = {
  "environments.status": {
    /** With `thread`, `chat` says whether that chat works on the computer and what its agent may do there. */
    params: z.object({ thread: ThreadId.optional() }).strict(),
    result: z.object({
      enabled: z.boolean(),
      ready: z.boolean(),
      name: z.string(),
      workspace: z.string(),
      model: z.string().optional(),
      demo: z.boolean().optional(),
      supported: z.boolean().optional(),
      phase: z
        .enum(["not_installed", "stopped", "preparing", "running", "stopping", "error", "unsupported"])
        .optional(),
      step: z.enum(["runtime", "guest", "desktop"]).optional(),
      /** While preparing: Linux is being set up for the first time, not booted. */
      setup: z.boolean().optional(),
      downloaded: z.number().nonnegative().optional(),
      total: z.number().nonnegative().optional(),
      error: z.string().optional(),
      /** What the owner still has to install or change on this host before the computer can start. */
      needs: ComputerNeed.optional(),
      /** The chats that work on the computer. */
      chats: z.array(z.string()).optional(),
      /** Agents the owner allowed to use it, for good: the Computers view shows once there is one. */
      allowed_agents: z.number().int().optional(),
      /** Those agents by id: each agent's card says whether it may use the computer. */
      allowed: z.array(z.string()).optional(),
      /** Every agent screen that is up or held, while the computer runs. */
      screens: z.array(ComputerScreen).optional(),
      /** How many agent screens the VM's memory holds at once. */
      max_screens: z.number().int().optional(),
      chat: z
        .object({
          thread: z.string(),
          on: z.boolean(),
          agent: z.string().optional(),
          agent_name: z.string().optional(),
          permitted: z.boolean().optional(),
          /** The chat's agent's own screen, once it has one. */
          screen: Screen.optional(),
        })
        .optional(),
      /** What the next start gives it; `restart` when that differs from what it runs with now. */
      resources: ComputerResources.optional(),
      /** What the running VM has now, as its instance holds it (absent while it is off). */
      running_resources: ComputerResources.partial().optional(),
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
    result: Ok,
    effect: true,
    access: "human",
  },
  /**
   * The owner starts the shared VM, putting a chat on it when named. `past_reserve`: start it anyway when only the
   * host's reserve beside the VM's memory is missing (the owner's alone; an agent's start always keeps it).
   */
  "environments.enable": {
    params: z.object({ thread: ThreadId.optional(), appearance: Look, past_reserve: z.boolean().optional() }).strict(),
    result: Ok,
    effect: true,
    replay: false,
    access: "human",
  },
  /**
   * An allowed agent puts the chat its run is in on the computer: it starts the shared VM when off (refused when free
   * memory cannot hold it) and takes the agent's own screen once it runs.
   */
  "environments.start": {
    params: Thread,
    result: Ok,
    effect: true,
    replay: false,
  },
  /** The chat goes back to this Mac and lets its screen go: the agent's own run, or the owner. */
  "environments.release": {
    params: Thread,
    result: Ok,
    effect: true,
    replay: false,
  },
  /** Shuts the shared VM down for every agent; its disk is kept. */
  "environments.stop": {
    params: z.object({ thread: ThreadId.optional() }).strict(),
    result: Ok,
    effect: true,
    replay: false,
    access: "human",
  },
  /**
   * The owner turns an allowed agent's screen on (to watch it, take it in hand, sign in somewhere) or off, while the
   * computer runs and no run of it works there. Past the cap a start is refused (`detail.reason` "screens_full", with
   * `max` and the names `up`), never taking another screen's place.
   */
  "environments.screen": {
    params: z.object({ agent: Id, on: z.boolean() }).strict(),
    result: Ok,
    effect: true,
    replay: false,
    access: "human",
  },
  /** The owner takes one agent's screen (stopping the run holding it) or hands it back. */
  "environments.control": {
    params: z.object({ screen: Screen, mode: z.enum(["agent", "human"]) }).strict(),
    result: Ok,
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.appearance": {
    params: z.object({ appearance: Look, thread: ThreadId.optional() }).strict(),
    result: Ok,
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.bind": {
    params: Thread,
    result: Ok,
    effect: true,
    access: "human",
  },
  "environments.display": {
    params: z.object({ screen: Screen }).strict(),
    result: z.object({ ticket: z.string(), expires_in: z.number() }),
    effect: true,
    access: "human",
    replay: false,
  },
  /** What the VM takes now, for the Computers view: memory assigned and used, its disk image. */
  "environments.usage": {
    params: z.object({}).strict(),
    result: z.object({
      running: z.boolean(),
      name: z.string().optional(),
      cpus: z.number().optional(),
      memory_assigned_mb: z.number().optional(),
      memory_used_mb: z.number().optional(),
      disk_mb: z.number().optional(),
    }),
    effect: false,
    access: "human",
  },
  /** An agent's run: on the screen it holds. The owner: on the agent screen they name and have in hand. */
  "environments.command": {
    params: Thread.extend({ command: z.string().min(1).max(4000), screen: Screen.optional() }).strict(),
    result: z.object({ code: z.number().int(), output: z.string() }),
    effect: true,
    replay: false,
  },
} as const;
