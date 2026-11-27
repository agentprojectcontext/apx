import { z } from "zod";
import { RunUsage } from "./domain-messages.ts";
import { HarnessId } from "./domain-models.ts";
import { Id } from "./domain-projects.ts";
import { RunEndReason, RunState } from "./domain-threads.ts";
import { schemaFields } from "./schema-fields.ts";

/** What an auxiliary model call was for: a chat's title, a long chat's summary, a room's gate, a sticker's meaning… */
export const AuxPurpose = z.enum([
  "title",
  "summary",
  "room",
  "commit",
  "suggestion",
  "memory_capture",
  "memory_dream",
  "activity_review",
  "contextual_discovery",
  "news",
  "sticker",
  "aside",
  "mail",
  /** What a voice call says (the model it talks with). */
  "call",
  /** Whether a deletion in Auto runs or asks the owner (DECISIONS.md#d-281). */
  "deletion",
  /** Whether another call in Auto runs or asks the owner (DECISIONS.md#d-283). */
  "action",
]);
export type AuxPurpose = z.infer<typeof AuxPurpose>;

/** What started a run. Everything enters through threads.send; this only says from where. */
export const RunTrigger = z.enum(["user", "a2a", "a2a_result", "surface", "channel", "routine", "system"]);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const Run = z.object(
  schemaFields({
    id: () => Id,
    thread_id: () => Id,
    agent_id: () => Id,
    state: () => RunState,
    trigger: () => RunTrigger.default("user"),
    /** Delegated runs point at the run that asked for them. */
    parent_run_id: () => Id.optional(),
    depth: () => z.number().int().nonnegative().default(0),
    deadline_at: () => z.string().optional(),
    harness: () => HarnessId.optional(),
    model: () => z.string().optional(),
    error: () => z.string().optional(),
    end_reason: () => RunEndReason.optional(),
    /** A run stopped by a provider limit: when the provider said that limit lifts. */
    resets_at: () => z.string().optional(),
    started_at: () => z.string(),
    ended_at: () => z.string().optional(),
    /** Tools called so far. */
    tool_calls: () => z.number().int().nonnegative().default(0),
    /** What it is doing right now ("Opened github.com"); absent when idle or finished. */
    activity: () => z.string().optional(),
    /** Tokens reported by the provider for the whole run, when it reports them. */
    usage: () => RunUsage.optional(),
  }),
);
export type Run = z.infer<typeof Run>;

/** One named piece of what a model call carried, in characters. */
export const PromptPart = z.object(
  schemaFields({
    name: () => z.string(),
    chars: () => z.number().int().nonnegative(),
  }),
);
export type PromptPart = z.infer<typeof PromptPart>;

/** What the model received on a run's first call: its system prompt, the turn's input, the tools, and their sizes. */
export const RunContext = z.object(
  schemaFields({
    run_id: () => Id,
    system: () => z.string(),
    input: () => z.string(),
    tools: () => z.array(z.string()),
    sizes: () =>
      z.object(
        schemaFields({
          /** The system prompt by part ("base" is APX's own text); they add up to its length. */
          system: () => z.array(PromptPart),
          /** The turn's input by block ("message" is what was said); they add up to its length. */
          input: () => z.array(PromptPart),
          tools: () => z.number().int().nonnegative(),
          history: () =>
            z.object(
              schemaFields({
                items: () => z.number().int().nonnegative(),
                chars: () => z.number().int().nonnegative(),
              }),
            ),
        }),
      ),
  }),
);
export type RunContext = z.infer<typeof RunContext>;

/** What an agent's turn carries, as the core stamped it: the owner's message, a helper's result, a routine… */
export const JobFrom = z.object(
  schemaFields({
    kind: () =>
      z.enum([
        "user",
        "agent",
        "surface",
        "channel",
        "routine",
        "mail",
        "input_answer",
        "job",
        "terminal",
        "go_on",
        "stalled_task",
        "task_continue",
        "plan_continue",
        "computer_ready",
        "task_result",
        "delegation_result",
        "added",
      ]),
    /** Who sent it (the helper, the contact, the routine, the surface), when it has a name. */
    name: () => z.string().optional(),
    /** The conversation it comes from, when another agent's (a teammate asked, a delegated chat): it opens there. */
    thread: () => Id.optional(),
  }),
);
export type JobFrom = z.infer<typeof JobFrom>;

/**
 * Every agent turn not over yet (working or queued) and the latest finished ones, or a terminal command an agent
 * started. `thread_id` opens the chat it belongs to.
 */
export const Job = z.object(
  schemaFields({
    id: () => Id,
    kind: () => z.enum(["agent", "terminal"]),
    title: () => z.string(),
    state: () => RunState,
    thread_id: () => Id,
    /** Display provenance even when the owning chat is not loaded by the operator. */
    thread_title: () => z.string().optional(),
    agent_name: () => z.string().optional(),
    /** Project context captured when the run was admitted; absent for historical jobs without a snapshot. */
    project_id: () => Id.optional(),
    project_name: () => z.string().optional(),
    /** The chat's current project, which may differ after a move. */
    thread_project_id: () => Id.optional(),
    thread_project_name: () => z.string().optional(),
    /** The persisted run that executed the command, not a caller's current turn. */
    run_id: () => Id.optional(),
    /** The thread that started it (a delegation's caller). */
    parent_thread_id: () => Id.optional(),
    agent_id: () => Id.optional(),
    trigger: () => RunTrigger,
    /** Agent jobs: what the turn carries, to name one still queued ("Alma's result"). */
    from: () => JobFrom.optional(),
    model: () => z.string().optional(),
    usage: () => RunUsage.optional(),
    tool_calls: () => z.number().int().nonnegative(),
    activity: () => z.string().optional(),
    /** Terminal jobs: where the command runs, how it exited, and whether it was started in the background. */
    cwd: () => z.string().optional(),
    exit_code: () => z.number().int().optional(),
    /** Terminal jobs that never started: the reason the process could not be created. */
    start_error: () => z.string().optional(),
    background: () => z.boolean().optional(),
    started_at: () => z.string(),
    ended_at: () => z.string().optional(),
  }),
);
export type Job = z.infer<typeof Job>;
