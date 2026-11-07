import type { Message, Part } from "@apx/protocol";

/**
 * Where a turn's plan shows: only in the chat's newest message that has one (an older version is replaced, not
 * repeated); while the run works it stays under everything it writes, and once it ends it keeps where it was last marked.
 */
export function planLast<T extends { part: Part }>(live: boolean, shown: boolean, blocks: T[]): T[] {
  const rest = blocks.filter((b) => b.part.type !== "plan");
  if (!shown) return rest;
  return live ? [...rest, ...blocks.filter((b) => b.part.type === "plan")] : blocks;
}

/** The chat's newest message with a plan: the only one whose plan is drawn. */
export function latestPlan(messages: Message[]): string | undefined {
  return messages.findLast((m) => m.parts.some((p) => p.type === "plan"))?.id;
}
