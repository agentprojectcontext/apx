// What Auto decided about each deletion it weighed (DECISIONS.md#d-281): ran without a card or asked, who decided and
// why, kept for the owner to review.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/** Why a fixed rule ran or asked for something a command deletes; the judge's own words come apart, in `why`. */
export const DeletionReason = z.enum([
  "scratch",
  "gone",
  "output",
  "made",
  "container",
  "merged_branch",
  "merged_worktree",
  "outside",
  "owner",
  "unmerged_branch",
  "open_worktree",
  "git_work",
  "too_many",
  "runtime",
  "no_match",
]);
export type DeletionReason = z.infer<typeof DeletionReason>;

/** Auto's decision on one call's deletion, as its chat step shows it. */
export const AutoDeletionNote = z.object(
  schemaFields({
    id: () => Id,
    verdict: () => z.enum(["run", "ask"]),
    /** A fixed rule, or the auxiliary model reading the task. */
    by: () => z.enum(["rule", "judge"]),
    /** The rules' reasons: for a verdict of the judge, what left it open. */
    reasons: () => z.array(DeletionReason).max(8),
    /** The judge's words, in the owner's language; absent when it did not answer. */
    why: () => z.string().max(200).optional(),
    /** The model that judged. */
    model: () => z.string().max(200).optional(),
    /** What it removes, in plain words, paths relative to the project. */
    items: () => z.array(z.string().max(400)).max(20),
  }),
);
export type AutoDeletionNote = z.infer<typeof AutoDeletionNote>;

/** One decision in the owner's review list. */
export const AutoDeletion = AutoDeletionNote.extend(
  schemaFields({
    at: () => z.string(),
    thread_id: () => Id,
    agent_id: () => Id,
    project_id: () => Id.optional(),
    /** The parts of the command that delete. */
    command: () => z.string().max(4000),
  }),
);
export type AutoDeletion = z.infer<typeof AutoDeletion>;

export const autoDeletionMethods = {
  /** Auto's deletion decisions, newest first; `next` is the `before` of the following page. */
  "auto_deletions.list": deferMethod({
    params: () =>
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
          /** The `next` of the page before. */
          before: z.string().max(64).optional(),
          verdict: z.enum(["run", "ask"]).optional(),
        })
        .strict(),
    result: () => z.object({ decisions: z.array(AutoDeletion), next: z.string().optional() }),
    effect: false,
    access: "human",
  }),
};
