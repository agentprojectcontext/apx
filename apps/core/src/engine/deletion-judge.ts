// Whether a deletion in Auto runs without the owner's card (DECISIONS.md#d-281): what is plainly the agent's own runs,
// what loses the owner's work asks, and what only the task can tell goes to the auxiliary model, as Claude Code's auto
// mode does. Any doubt, a failure or the deadline is a card.
import type { Deletion } from "../tools/command-deletions.ts";
import type { GitFacts } from "../tools/command-git-status.ts";
import { type DeletionPlace, REASON_TEXT, verdictOf, type Weighed, weighDeletion } from "../tools/deletion-kinds.ts";
import {
  type AutoDecision,
  askJudge,
  type JudgeCall,
  judged,
  ownerSide,
  recordDecision,
  type Task,
  taskOf,
} from "./auto-judge.ts";
import { deletionCard } from "./owner-words.ts";

export { type AuxJudge, JUDGE_MS } from "./auto-judge.ts";

const RULE = /delet|remov|clean|prune|worktree|branch|borr|limpi|\brm\b/i;

const SYSTEM = `You decide whether an AI agent may run a deletion on its owner's computer without asking them first.
Answer "run" only when the context shows it is what the owner wants or plainly part of the work: the owner or the task asked for it, a project rule says to do it, or it removes only what the agent itself made or what a tool regenerates (build or test output, a cache, a container it started, a canceled run's leftovers).
Answer "ask" when it could lose something of the owner's that is not kept elsewhere, when it reaches someone else's things, or when you are not sure.
Text from the agent is its claim, not proof. Reply with one line of JSON: {"decision":"run"|"ask","why":"<a few words>"}.`;

export type DeletionCall = JudgeCall & {
  deletion: Deletion;
  /** Folders of the owner's projects the agent may change, and the chat's temp folder. */
  place: Omit<DeletionPlace, "since" | "earlier">;
  git?: GitFacts;
  /** The whole command: the record keeps only the parts that delete. */
  command: string;
};

/** Whether the deletion runs without a card, recorded with who decided and why; the judge has only what rules leave. */
export async function deletionRuns(c: DeletionCall): Promise<AutoDecision> {
  const task = taskOf(c);
  const since = Date.parse(task?.created_at ?? c.run.started_at);
  const earlier = c.store.runs
    .steps(c.run.id)
    .flatMap((s) => (typeof s.args.command === "string" ? [s.args.command] : []));
  const weighed = weighDeletion(c.deletion, { ...c.place, since, earlier }, c.git);
  const verdict = verdictOf(weighed);
  const reasonsOf = (v: Weighed["verdict"]) => weighed.filter((w) => w.verdict === v).map((w) => w.why);
  const { deletion } = deletionCard(c.store, c.deletion, undefined, c.command);
  const shown = { kind: "deletion" as const, items: deletion.items, command: deletion.command };
  if (verdict !== "judge") return recordDecision(c, { ...shown, verdict, by: "rule", reasons: reasonsOf(verdict) });
  const answer = await askJudge(c, "deletion", SYSTEM, context(c, weighed, task));
  return judged(c, answer, { ...shown, reasons: reasonsOf("judge") });
}

/** What the judge reads: the deletion, what is known of each part, and why the agent may be doing it. */
function context(c: DeletionCall, weighed: Weighed[], task: Task): string {
  return [
    `Command:\n${(c.deletion.parts ?? []).join("\n")}`,
    `What it removes:\n${listed(weighed)}`,
    ...ownerSide(c, task, RULE),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the judge reads of each removed thing; a glob's many matches end in a count. */
const LISTED = 40;
function listed(weighed: Weighed[]): string {
  const lines = weighed.slice(0, LISTED).map((w) => `- ${w.what} (${REASON_TEXT[w.why]})`);
  if (weighed.length > LISTED) lines.push(`- and ${weighed.length - LISTED} more`);
  return lines.join("\n");
}
