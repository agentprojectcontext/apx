import { z } from "zod";
import { ModelChoice } from "./domain-models.ts";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/** `queued`: a delegation past the cap of its caller's thread, waiting for one of them to end (DECISIONS.md#d-096). */
export const RunState = z.enum(["queued", "submitted", "working", "input-required", "completed", "failed", "canceled"]);
export type RunState = z.infer<typeof RunState>;
export const TERMINAL_RUN_STATES: readonly RunState[] = ["completed", "failed", "canceled"];

/**
 * Why a run ended, when APX knows: `step_limit` is a turn on APX's own loop that used all its steps (its answer is
 * a progress report, not a final result); `provider_limit` is the model provider's usage limit (its plan or rate),
 * not a fault of the agent; `deadline` is the run's time running out. Absent on runs older than the field and on
 * outside engines' completed turns, which cannot tell.
 */
export const RunEndReason = z.enum(["normal", "step_limit", "failed", "canceled", "deadline", "provider_limit"]);
export type RunEndReason = z.infer<typeof RunEndReason>;

/** `call`: a voice call with an agent (call-methods.ts). */
export const ThreadKind = z.enum([
  "home",
  "agent",
  "loose",
  "a2a",
  "group",
  "code",
  "channel",
  "task",
  "routine",
  "call",
]);
/** What an agent may change in a code thread's folder: ask each time, change files freely, or only read. */
export const WritePolicy = z.enum(["ask", "auto", "read-only"]);
export type WritePolicy = z.infer<typeof WritePolicy>;
export type ThreadKind = z.infer<typeof ThreadKind>;

/**
 * Why a mail is kept but neither answered, told nor given to the agent: written by no person, in the server's Spam
 * folder, not verified by its server, from a "Never read" address, or from outside "Who may write".
 */
export const MailMark = z.enum(["automatic", "spam", "unverified", "blocked", "outside"]);
export type MailMark = z.infer<typeof MailMark>;

export const Thread = z.object(
  schemaFields({
    id: () => Id,
    kind: () => ThreadKind,
    title: () => z.string(),
    agent_ids: () => z.array(Id),
    project_id: () => Id.optional(),
    /** a2a sub-threads point at the thread (and message) they were spawned from. */
    parent_id: () => Id.optional(),
    /** The task this chat works on: its agent's answers are posted back to the task as comments. */
    task_id: () => Id.optional(),
    /** The routine whose execution opened this chat; stable across routine renames. */
    routine_id: () => Id.optional(),
    /** A Flow's AI model step opened this chat: that Flow, and the step's id in it. */
    flow: () =>
      z
        .object(
          schemaFields({
            id: () => Id,
            step: () => Id.optional(),
          }),
        )
        .optional(),
    /** An a2a sub-thread's name: its caller continues the same session (same agent, same context) by it. */
    session: () => z.string().optional(),
    /** A helper's name: a session its caller (agent_ids[0]) runs under instructions it wrote for one task. */
    worker: () => z.string().optional(),
    /** Code threads: the folder the agent works in (inside its project) and what it may change there. */
    cwd: () => z.string().optional(),
    write: () => WritePolicy.optional(),
    /**
     * A session with an outside engine itself ("claude", "codex", "acp:opencode"): the owner talks to that engine with
     * its own prompt, in `cwd`; no agent persona, notes or roster. Its agent only owns the run.
     */
    engine: () => z.string().optional(),
    /** Channel threads: the conversation on a channel (a Telegram chat…) and the person on the other side. */
    channel: () =>
      z
        .object(
          schemaFields({
            id: () => z.string(),
            conversation: () => z.string(),
            person_id: () => Id.optional(),
          }),
        )
        .optional(),
    /** A mailbox chat holding only marked mail (none once its sender writes a mail a person wrote): the latest mark. */
    mail_mark: () => MailMark.optional(),
    /** The chat's own model, picked in its composer; absent = the agent's. */
    model_choice: () => ModelChoice.optional(),
    /** A call's chat: `quick` for a request said by name, and the paired device (a phone) it talked through. */
    call: () =>
      z
        .object(
          schemaFields({
            mode: () => z.enum(["call", "quick"]),
            device: () => z.string().optional(),
          }),
        )
        .optional(),
    /** The chat in which the super-agent told what an update brought: that release's version. */
    release: () => z.string().optional(),
    /** The automatic title, present only while the owner's own name (`title`) stands over it. */
    auto_title: () => z.string().optional(),
    /** Pinned by the owner: first within its group in every list. */
    pinned: () => z.boolean().optional(),
    /** Archived by the owner: out of the lists (threads.list `include_archived`) until unarchived. */
    archived: () => z.boolean().optional(),
    state: () => RunState.or(z.literal("idle")),
    preview: () => z.string().default(""),
    unread: () => z.number().int().nonnegative().default(0),
    created_at: () => z.string(),
    updated_at: () => z.string(),
  }),
);
export type Thread = z.infer<typeof Thread>;

/** A group chat's members in order, the model each answers with there (by agent id) and the model that picks who answers. */
export const GroupSettings = z.object(
  schemaFields({
    agent_ids: () => z.array(Id),
    models: () => z.record(Id, z.string()),
    /** One model for every member, over `models`. */
    model: () => z.string().optional(),
    router_model: () => z.string().optional(),
    /** What runs when nothing is picked in the group: each member's own first model, and the auxiliary one. */
    defaults: () =>
      z.object(
        schemaFields({
          members: () => z.record(Id, z.string()),
          router: () => z.string().optional(),
        }),
      ),
  }),
);
export type GroupSettings = z.infer<typeof GroupSettings>;

export const Author = z.discriminatedUnion("kind", [
  /** `direct`: the owner wrote to a contact themselves (sent as is), rather than telling the agent what to answer. */
  z.object(
    schemaFields({
      kind: () => z.literal("user"),
      direct: () => z.boolean().optional(),
    }),
  ),
  z.object(
    schemaFields({
      kind: () => z.literal("agent"),
      id: () => Id,
    }),
  ),
  z.object(
    schemaFields({
      kind: () => z.literal("system"),
    }),
  ),
  /** Text sent by a widget's sendPrompt(): shown apart from the owner's own messages. */
  z.object(
    schemaFields({
      kind: () => z.literal("surface"),
      id: () => Id,
      title: () => z.string(),
    }),
  ),
  /** Someone other than the owner, writing on a channel (a contact). */
  z.object(
    schemaFields({
      kind: () => z.literal("person"),
      id: () => Id,
      name: () => z.string(),
      channel: () => z.string(),
    }),
  ),
]);
export type Author = z.infer<typeof Author>;
