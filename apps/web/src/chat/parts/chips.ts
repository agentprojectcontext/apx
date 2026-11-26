// Something the agent did quietly on the side (saved a note, added to research): one small chip per kind in its answer,
// opened to what it saved, instead of a step among its actions. See DECISIONS.md#d-276
import type { Part } from "@apx/protocol";

type Notice = Extract<Part, { type: "notice" }>;

const CHIP_CODES: ReadonlySet<string> = new Set(["memory.saved", "research.updated"]);

export const isChip = (p: Part): boolean => p.type === "notice" && CHIP_CODES.has(p.code);
const chipOf = (p: Part): Notice | undefined => (p.type === "notice" && CHIP_CODES.has(p.code) ? p : undefined);

/** One chip per kind: the later ones of a kind fold into the first, and the steps they stand for leave the steps. */
export function chipFold(parts: readonly Part[]): { later: ReadonlySet<Part>; calls: ReadonlySet<string> } {
  const first = new Set<string>();
  const later = new Set<Part>();
  const calls = new Set<string>();
  for (const part of parts) {
    const p = chipOf(part);
    if (!p) continue;
    if (typeof p.vars?.call === "string") calls.add(p.vars.call);
    if (first.has(p.code)) later.add(part);
    else first.add(p.code);
  }
  return { later, calls };
}
