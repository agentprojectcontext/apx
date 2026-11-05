import type { Part } from "@apx/protocol";

/** While the run works its plan stays under everything it writes; once it ends, it keeps where it was last marked. */
export function planLast<T extends { part: Part }>(live: boolean, blocks: T[]): T[] {
  if (!live) return blocks;
  return [...blocks.filter((b) => b.part.type !== "plan"), ...blocks.filter((b) => b.part.type === "plan")];
}
