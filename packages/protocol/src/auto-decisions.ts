// What Auto decided about each deletion it weighed (DECISIONS.md#d-281) and each call its judge read (DECISIONS.md#d-283):
// ran without a card or asked, who decided and why, kept for the owner to review.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/** Why a fixed rule ran or asked, or why a call reached the judge; the judge's own words come apart, in `why`. */
export const DecisionReason = z.enum([
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
  // Why a call that is not a deletion reached the judge.
  "outside_content",
  "url_data",
  "browser_steps",
  "connected_service",
  "needs_ok",
  "remote",
  "script",
  // A call carrying something shaped like a key, a token or a password: always the owner's card.
  "credential",
]);
export type DecisionReason = z.infer<typeof DecisionReason>;

/** Auto's decision on one call, as its chat step shows it: what it deletes, or the call itself. */
export const AutoDecisionNote = z.object(
  schemaFields({
    id: () => Id,
    kind: () => z.enum(["deletion", "action"]),
    /** The tool a call used, for a decision on the call itself. */
    tool: () => z.string().max(200).optional(),
    verdict: () => z.enum(["run", "ask"]),
    /** A fixed rule, or the auxiliary model reading the task. */
    by: () => z.enum(["rule", "judge"]),
    /** The rules' reasons: for a verdict of the judge, what left it open. */
    reasons: () => z.array(DecisionReason).max(8),
    /** The judge's words, in the owner's language; absent when it did not answer. */
    why: () => z.string().max(200).optional(),
    /** The model that judged. */
    model: () => z.string().max(200).optional(),
    /** What it removes, in plain words, paths relative to the project; for a call, what it does. */
    items: () => z.array(z.string().max(400)).max(20),
  }),
);
export type AutoDecisionNote = z.infer<typeof AutoDecisionNote>;

/** One decision in the owner's review list. */
export const AutoDecision = AutoDecisionNote.extend(
  schemaFields({
    at: () => z.string(),
    thread_id: () => Id,
    agent_id: () => Id,
    project_id: () => Id.optional(),
    /** The parts of the command that delete; for a call, its arguments as the judge read them. */
    command: () => z.string().max(4000),
  }),
);
export type AutoDecision = z.infer<typeof AutoDecision>;

export const autoDecisionMethods = {
  /** Auto's decisions, newest first; `next` is the `before` of the following page. */
  "auto_decisions.list": deferMethod({
    params: () =>
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
          /** The `next` of the page before. */
          before: z.string().max(64).optional(),
          verdict: z.enum(["run", "ask"]).optional(),
        })
        .strict(),
    result: () => z.object({ decisions: z.array(AutoDecision), next: z.string().optional() }),
    effect: false,
    access: "human",
  }),
};
