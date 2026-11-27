// Whether a delegated run a limit cut short was getting somewhere, as a supervisor would judge it: APX goes on with it
// on its own while it is, and stops for the owner only when a part looks stuck (DECISIONS.md#d-116).
import type { Step } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

/** Parts APX starts on its own in a row after the first one: a ceiling far past real work, not the usual stop. */
export const MAX_AUTO_PARTS = 8;

const signature = (s: Step) => `${s.tool}:${JSON.stringify(s.args)}`;

/** A finished foreground test/check, not a lookup, arbitrary shell output, or a submitted background job. */
export function verifiedCheck(steps: readonly Step[]): boolean {
  return steps.some((s) => {
    if (s.state !== "ok" || s.tool !== "shell" || s.args.background || typeof s.args.command !== "string") return false;
    return verificationCommand(s.args.command);
  });
}

export function verificationCommand(command: string): boolean {
  return /^(?:(?:pnpm|npm|yarn|bun)(?: run)? (?:test(?=\s|$)|preflight\b|verify\b|typecheck\b|check:[\w-]+\b)|node --test\b|pytest\b)[^;&|\n`$><]*$/.test(
    command.trim(),
  );
}

/** One observed check can count between completed plan steps, even when no checklist item changed. */
export function recordVerification(store: Store, threadId: string, agentId: string, at: string): boolean {
  const thread = store.threads.get(threadId);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!task || task.state !== "open" || task.assignee !== agentId || thread?.agent_ids[0] !== agentId) return false;
  const ctx = store.threads.context(task.thread_id);
  const milestone = ctx.progress_at ?? task.created_at;
  if (at < milestone || ctx.verified_progress?.milestone === milestone) return false;
  store.threads.mergeContext(task.thread_id, { verified_progress: { milestone, at } });
  return true;
}

/**
 * Why the part in `steps` made no progress after the part before it (`before`), or undefined when it did: it got
 * something done with an effect, mostly worked, and did not go round the same calls or redo the last part's. One part
 * that only reads after one that changed something is checking that work, not a stall (DECISIONS.md#d-210).
 */
export function stalled(steps: readonly Step[], before: readonly Step[] = []): string | undefined {
  const done = steps.filter((s) => s.state === "ok" || s.state === "error");
  const ok = done.filter((s) => s.state === "ok");
  if (!ok.length) return "none of its calls worked";
  if (ok.length < done.length / 5) return "most of its calls failed";
  const acted = new Set(ok.filter((s) => s.effect !== "none").map(signature));
  const actedBefore = before.some((s) => s.state === "ok" && s.effect !== "none");
  if (!acted.size && !actedBefore) return "it only looked things up and changed nothing";
  if (new Set(done.map(signature)).size < done.length / 2) return "it kept repeating the same calls";
  const earlier = new Set(before.map(signature));
  const redone = [...acted].filter((x) => earlier.has(x)).length;
  if (earlier.size && acted.size && redone >= acted.size * 0.8) return "it redid what its last part had done";
  return undefined;
}
