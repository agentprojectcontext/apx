import type { Message, Part } from "@apx/protocol";

/**
 * Where a turn's plan shows: only in the chat's newest message that has one (an older version is replaced, not
 * repeated). It stays under everything the turn wrote, so what is left to do is the last thing read; once the run ended
 * with every step done it goes on top, and the answer is what closes the turn.
 */
export function planLast<T extends { part: Part }>(live: boolean, shown: boolean, blocks: T[]): T[] {
  const rest = blocks.filter((b) => b.part.type !== "plan");
  if (!shown) return rest;
  const plan = blocks.filter((b) => b.part.type === "plan");
  const finished = plan.every((b) => b.part.type === "plan" && b.part.steps.every((s) => s.state === "done"));
  return !live && finished ? [...plan, ...rest] : [...rest, ...plan];
}

/** The chat's newest message with a plan: the only one whose plan is drawn. */
export function latestPlan(messages: Message[]): string | undefined {
  return messages.findLast((m) => m.parts.some((p) => p.type === "plan"))?.id;
}
