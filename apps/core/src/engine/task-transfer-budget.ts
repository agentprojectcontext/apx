import type { TaskReviewHandoff } from "../domain/tasks.ts";
import { MAX_HANDOFF_DEPTH, MAX_REVIEW_ROUNDS } from "./task-limits.ts";

export type Transfer = { from: string; to: string; review?: TaskReviewHandoff };
export type TransferPolicy = { verified: true; reason?: string; review?: TaskReviewHandoff };

/** Review returns spend one bounded pair's budget only after a recorded independent review assignment. */
export function transferBudget(
  initial: string,
  moves: Transfer[],
  next: Transfer,
  requestReview: boolean,
): TransferPolicy {
  let transfers = 0;
  let rounds = 0;
  let pair: { author: string; reviewer: string } | undefined;
  let reviewing = false;
  let review: TaskReviewHandoff | undefined;
  const visited = new Set([initial]);
  for (const [index, move] of [...moves, next].entries()) {
    const pending = index === moves.length;
    const wantsReview = pending ? requestReview : Boolean(move.review);
    const returning = reviewing && move.from === pair?.reviewer && move.to === pair.author;
    if (returning && !wantsReview) reviewing = false;
    else if (wantsReview) {
      if (pair && (move.from !== pair.author || move.to !== pair.reviewer))
        return { verified: true, reason: "it changes the independent review pair" };
      if (!pair && visited.has(move.to)) return { verified: true, reason: "it gives work back up its active chain" };
      pair ??= { author: move.from, reviewer: move.to };
      rounds++;
      if (rounds > MAX_REVIEW_ROUNDS) return { verified: true, reason: "it exceeds two independent review rounds" };
      const expected = { ...pair, round: rounds };
      if (
        !pending &&
        (move.review?.author !== expected.author ||
          move.review.reviewer !== expected.reviewer ||
          move.review.round !== rounds)
      )
        return { verified: true, reason: "its independent review assignment cannot be verified" };
      if (pending) review = expected;
      reviewing = true;
    } else {
      if (visited.has(move.to)) return { verified: true, reason: "it gives work back up its active chain" };
      transfers++;
      reviewing = false;
    }
    visited.add(move.to);
  }
  return transfers + (rounds ? 1 : 0) > MAX_HANDOFF_DEPTH
    ? { verified: true, reason: "it exceeds three active hand-offs" }
    : { verified: true, ...(review ? { review } : {}) };
}
