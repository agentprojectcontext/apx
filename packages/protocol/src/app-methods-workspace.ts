// Methods behind the app screens.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import {
  ApprovalScope,
  Autonomy,
  BaseProject,
  ChatgptStatus,
  GroupSettings,
  Id,
  Job,
  Message,
  ModelRef,
  Organization,
  PendingInput,
  Project,
  ProjectKind,
  Run,
  Thread,
  WorkflowView,
  WritePolicy,
} from "./domain.ts";

export const appWorkspaceMethods = {
  /** Internal: an external harness (Codex) lists the tools of the run that owns `token`. */
  "harness.tools": deferMethod({
    params: () =>
      z
        .object({
          token: z.string().min(32).max(128),
        })
        .strict(),
    result: () =>
      z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            parameters: z.unknown(),
          }),
        ),
      }),
    effect: false,
  }),
  /** Internal: an external harness calls one APX tool inside the run that owns `token`. */
  "harness.call": deferMethod({
    params: () =>
      z
        .object({
          token: z.string().min(32).max(128),
          tool: z.string(),
          args: z.record(z.string(), z.unknown()),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.boolean(),
        text: z.string(),
      }),
    effect: true,
  }),
  "projects.list": deferMethod({
    params: () =>
      z
        .object({
          include_unregistered: z.boolean().default(false),
        })
        .strict(),
    /** `base`: how the owner named, described and typed the base project (it has no folder of its own). */
    result: () =>
      z.object({
        projects: z.array(Project),
        base: BaseProject,
      }),
    effect: false,
  }),
  /** Names, describes or types the base project; "" or null removes a description or kind. */
  "projects.update_base": deferMethod({
    params: () =>
      z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          kind: ProjectKind.nullable().optional(),
          /** How far agents without one of their own go here; null = auto. */
          autonomy: Autonomy.nullable().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        base: BaseProject,
      }),
    effect: true,
    access: "human",
  }),
  /** A project's areas and roles (no project: the base project's). Empty until the owner or a team adds some. */
  "org.get": deferMethod({
    params: () =>
      z
        .object({
          project: Id.optional(),
        })
        .strict(),
    result: () => Organization,
    effect: false,
  }),
  /** Replaces a project's areas and roles: written to its .agent/organization.json (the base project's: in APX). */
  "org.set": deferMethod({
    params: () =>
      z
        .object({
          project: Id.optional(),
          organization: Organization,
        })
        .strict(),
    result: () => Organization,
    effect: true,
    access: "human",
  }),
  /** Registers a folder as a project and reads its AGENTS.md and .agent/ (never writes them). */
  "projects.register": deferMethod({
    params: () =>
      z
        .object({
          path: z.string().min(1).max(1024),
          /** A plain folder becomes a project: an AGENTS.md naming it and an empty .agent/ are written there. */
          init: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        project: Project,
        agents: z.number().int(),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Retries moving a project's agents and settings from `.apc/`, the folder earlier versions used, to `.agent/` (the core
   * does it by itself at start and on register): copies them, checks every file arrived equal, removes them from `.apc/`
   * and reads the project again. Safe to run again: a file
   * `.agent/` already has with other content stops it before anything is removed. Git worktrees in `.apc/` stay.
   */
  "projects.move_folder": deferMethod({
    params: () => z.object({ project: Id }).strict(),
    result: () =>
      z.object({
        project: Project,
        agents: z.number().int(),
        /** Files now in `.agent/` that came from `.apc/`. */
        files: z.number().int(),
        /** `.apc/` is gone, or holds only the worktrees in `kept`. */
        done: z.boolean(),
        kept: z.array(z.string()),
        /** Files `.agent/` already has with other content: nothing was removed until the owner settles them. */
        conflicts: z.array(z.string()),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * A new project: in a folder (made if missing; a plain one gets an AGENTS.md and .agent/), or, without one, in a folder
   * of its own inside APX's home (`projects/<name>`). Name, kind and description go to its .agent/project.json; a project
   * in a folder with no name given keeps the folder's. With `parent` it is a subproject of that project
   * (BASE_PROJECT_ID: of the base project); without a path its folder goes inside the parent's (the base project's:
   * in APX's home, as above).
   */
  "projects.create": deferMethod({
    params: () =>
      z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          kind: ProjectKind.optional(),
          description: z.string().trim().max(500).optional(),
          path: z.string().trim().min(1).max(1024).optional(),
          parent: Id.optional(),
        })
        .strict()
        .refine((p) => p.name || p.path, "a name or a folder"),
    result: () =>
      z.object({
        project: Project,
        agents: z.number().int(),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Renames a project, or changes its description or kind, in its .agent/project.json (every other key there stays).
   * An empty string or null removes the field. The base project has no folder and cannot be changed.
   */
  "projects.update": deferMethod({
    params: () =>
      z
        .object({
          project: Id,
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          kind: ProjectKind.nullable().optional(),
          /** How far agents without one of their own go here; null = auto. Kept by APX, not in the folder. */
          autonomy: Autonomy.nullable().optional(),
          /** Replaces the folders its agents may only read: absolute (or "~/…"), existing, outside APX's home. */
          read_only_folders: z.array(z.string().trim().min(1).max(1024)).max(20).optional(),
          /**
           * Makes it a subproject of that project (BASE_PROJECT_ID: of the base project); null makes it a project of
           * its own again, which stops taking its parent's agents and resources. Refused for a project with subprojects,
           * for itself and for a parent that is a subproject. Its folder stays where it is.
           */
          parent: Id.nullable().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        project: Project,
      }),
    effect: true,
    access: "human",
  }),
  /** Optional, owner-only review of existing context; never changes an agent definition. */
  "projects.helper_review": deferMethod({
    params: () =>
      z
        .object({
          project: Id,
          manual: z.boolean().default(false),
          draft: z
            .object({
              role: z.string().max(500),
              prompt: z.string().max(100000),
            })
            .strict()
            .optional(),
        })
        .strict(),
    result: () =>
      z.object({
        enabled: z.boolean(),
        offer: z.boolean(),
        fingerprint: z.string(),
        missing: z.array(z.enum(["goal", "first_result", "role", "instructions"])),
        agent_gaps: z.array(
          z.object({
            id: Id,
            name: z.string(),
            missing: z.array(z.enum(["role", "instructions"])),
          }),
        ),
        goal: z.string(),
        first_result: z.string(),
        brief: z.string(),
        recipient: Id.optional(),
        suggested_prompt: z.string().optional(),
      }),
    effect: false,
    access: "human",
  }),
  "projects.helper_set": deferMethod({
    params: () =>
      z
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
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /** Reads the project's files again (all projects when `project` is absent). */
  "projects.sync": deferMethod({
    params: () =>
      z
        .object({
          project: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        projects: z.number().int(),
        agents: z.number().int(),
        archived: z.number().int(),
      }),
    effect: true,
  }),
  /**
   * Removes a folder from the registry; its files and existing conversations remain available. Its subprojects become
   * projects of their own.
   */
  "projects.unregister": deferMethod({
    params: () =>
      z
        .object({
          project: Id,
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  "threads.list": deferMethod({
    params: () =>
      z
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
    result: () =>
      z.object({
        threads: z.array(Thread),
        /** With `delegated`: how many chats (not archived) each listed chat delegated, for the ones that did. */
        delegated: z.record(z.string(), z.number().int().nonnegative()).optional(),
        /**
         * With `root_thread`: the teammates its agent asked on its task from it. They hang under the task's conversation;
         * they and theirs are listed as the chat's own.
         */
        asked: z.array(Id).optional(),
      }),
    effect: false,
  }),
  "threads.get": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
        })
        .strict(),
    result: () =>
      z.object({
        thread: Thread,
        messages: z.array(Message),
        runs: z.array(Run),
      }),
    effect: false,
  }),
  "threads.create": deferMethod({
    params: () =>
      z
        .object({
          kind: z.enum(["agent", "loose", "code"]),
          agent_id: Id,
          title: z.string().max(200).optional(),
          project_id: Id.optional(),
          /** Code threads: a folder inside the project (relative, or absolute under it); default the project's root. */
          cwd: z.string().max(1024).optional(),
          write: WritePolicy.optional(),
          /** External sessions only: full engine/model reference, optionally #effort; omitted uses the engine default. */
          model: ModelRef.optional(),
          /** A code thread with an outside engine itself ("claude", "codex", "acp:opencode"): its own prompt, no persona. */
          engine: z
            .string()
            .regex(/^(claude|codex|aider|antigravity|acp:[a-z0-9][a-z0-9-]*)$/)
            .optional(),
        })
        .strict(),
    result: () => Thread,
    effect: true,
  }),
  /**
   * A group chat of the owner and 2–5 agents (D-218, rules/GROUP_CHAT.md). Its messages go
   * through threads.send; each answer comes from the agents an @mention names, or the ones a cheap model picks.
   */
  "threads.group": deferMethod({
    params: () =>
      z
        .object({
          agent_ids: z.array(Id).min(2).max(5),
          title: z.string().max(200).optional(),
        })
        .strict(),
    result: () => Thread,
    effect: true,
    access: "human",
  }),
  /** A group chat's members, the model each answers with there, and the model that picks who answers. */
  "threads.group_get": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
        })
        .strict(),
    result: () => GroupSettings,
    effect: false,
    access: "human",
  }),
  /**
   * Changes a group chat's members (2–5), a member's model there (null: the agent's own), one model for all of them
   * (null: each its own) or the model that picks who answers (null: the auxiliary model). Only what is given changes.
   */
  "threads.group_set": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
          agent_ids: z.array(Id).min(2).max(5).optional(),
          models: z.record(Id, z.string().max(200).nullable()).optional(),
          model: z.string().max(200).nullable().optional(),
          router_model: z.string().max(200).nullable().optional(),
        })
        .strict(),
    result: () => GroupSettings,
    effect: true,
    access: "human",
  }),
  /**
   * The one way to talk to an agent. The message and its run are stored before this returns, so a restart does not
   * lose them; the run streams as events. `interrupt` cancels the turn in progress first; `queue` waits for it.
   */
  "threads.send": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
          text: z.string().min(1).max(50000),
          /**
           * queue: after what is running. interrupt: stop the running turn, then this. steer: into the running turn
           * at its next step (APX's own loop); when nothing can take it, it queues.
           */
          mode: z.enum(["queue", "interrupt", "steer"]).default("queue"),
          /** Owner-only: continue this stopped delegated run, only if it is still the session's latest run. */
          continue_run: Id.optional(),
          /** Files and images uploaded with media.upload, shown with the message and read by the agent. */
          attachments: z.array(Id).max(8).optional(),
          /** The owner wrote from APX's panel in Chrome: this turn browses in their Chrome (DECISIONS.md#d-198). */
          via: z.literal("chrome").optional(),
        })
        .strict(),
    /** `steered`: the text went into the running turn `run` instead of starting a new one. */
    result: () =>
      z.object({
        message: Message,
        run: Run,
        steered: z.boolean().optional(),
      }),
    effect: true,
  }),
  /** Running work plus the most recently finished, newest first (the background view). */
  /** With `thread`: that chat's commands only (the agent's terminal), running and finished, newest first. */
  "jobs.list": deferMethod({
    params: () =>
      z
        .object({
          finished: z.number().int().min(0).max(100).default(30),
          thread: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        running: z.array(Job),
        finished: z.array(Job),
      }),
    effect: false,
  }),
  /** What agents are waiting on from the owner (confirmations, questions), oldest first. */
  "runs.pending": deferMethod({
    params: () =>
      z
        .object({
          thread: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        inputs: z.array(PendingInput),
      }),
    effect: false,
  }),
  /**
   * The owner's answer to a pending input: approve/deny for a confirmation, text (or one of its options) for a
   * question. Only the owner answers; an expired input refuses the answer.
   */
  "runs.respond": deferMethod({
    params: () =>
      z
        .object({
          input: Id,
          artifact_review: z.string().uuid().optional(),
          decision: z.enum(["approve", "deny"]).optional(),
          scope: ApprovalScope.optional(),
          text: z.string().max(4000).optional(),
        })
        .strict(),
    result: () => PendingInput,
    effect: true,
    access: "human",
  }),
  /** A waiting message of the owner's, changed before its turn starts; a turn that started refuses it. */
  "runs.update_queued": deferMethod({
    params: () =>
      z
        .object({
          run: Id,
          text: z.string().min(1).max(50000),
        })
        .strict(),
    result: () =>
      z.object({
        message: Message,
      }),
    effect: true,
    access: "human",
  }),
  /** Takes a waiting message of the owner's out of the line and out of the chat, before its turn starts. */
  "runs.remove_queued": deferMethod({
    params: () =>
      z
        .object({
          run: Id,
        })
        .strict(),
    result: () =>
      z.object({
        removed: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /** The chat's waiting messages in the order they should run: all of them, each once. */
  "runs.reorder": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
          runs: z.array(Id).min(1).max(100),
        })
        .strict(),
    result: () =>
      z.object({
        messages: z.array(Message),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * The owner's waiting message now: the running turn cuts its current step short and takes it. `now` false: the
   * agent can only take it between turns (an outside engine): its turn at work is stopped and the message runs first.
   * With no turn at work it only goes first in line.
   */
  "runs.send_now": deferMethod({
    params: () =>
      z
        .object({
          message: Id,
        })
        .strict(),
    result: () =>
      z.object({
        now: z.boolean(),
      }),
    effect: true,
    access: "human",
  }),
  /** Takes back a waiting message of the owner's before the agent reads it: out of its turn or the line, and the chat. */
  "runs.unsend": deferMethod({
    params: () =>
      z
        .object({
          message: Id,
        })
        .strict(),
    result: () =>
      z.object({
        removed: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /** One job; for a terminal job, the end of its output (or a page of it from `offset`). */
  "jobs.get": deferMethod({
    params: () =>
      z
        .object({
          job: Id,
          offset: z.number().int().min(0).optional(),
          max_chars: z.number().int().min(100).max(100000).default(8000),
        })
        .strict(),
    result: () =>
      z.object({
        job: Job,
        output: z.string(),
        size: z.number().int(),
        offset: z.number().int(),
      }),
    effect: false,
  }),
  /** Stops a job: a terminal command is killed; an agent's run is canceled with what it delegated. */
  "jobs.cancel": deferMethod({
    params: () =>
      z
        .object({
          job: Id,
        })
        .strict(),
    result: () =>
      z.object({
        canceled: z.boolean(),
      }),
    effect: true,
  }),
  /** A workflow an agent started: its phases and agents, and each step's output once done (DECISIONS.md#d-273). */
  "workflows.get": deferMethod({
    params: () => z.object({ workflow: Id }).strict(),
    result: () =>
      z.object({
        workflow: WorkflowView.extend({ id: Id, thread_id: Id }),
        outputs: z.array(z.object({ key: z.string(), output: z.string() })),
      }),
    effect: false,
  }),
  /** Stops a running workflow: its agents at work are canceled and no step starts after them. */
  "workflows.stop": deferMethod({
    params: () => z.object({ workflow: Id }).strict(),
    result: () => z.object({ stopped: z.boolean() }),
    effect: true,
  }),
  /** Runs a stopped or failed workflow again: done steps keep their output, the rest run again. */
  "workflows.resume": deferMethod({
    params: () => z.object({ workflow: Id }).strict(),
    result: () => z.object({ resumed: z.boolean() }),
    effect: true,
  }),
  /** Whether the ChatGPT plan is signed in for APX's own loop, and a sign-in in progress. */
  "chatgpt.status": deferMethod({
    params: () => z.object({}).strict(),
    result: () => ChatgptStatus,
    effect: false,
    access: "human",
  }),
} as const;
