// What the open editor does with a drawing an agent saved while the owner watches (DECISIONS.md#d-175).
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";

/** A step the agent added or changed, for a brief mark on the canvas. */
export type Fresh = ReadonlyMap<string, "new" | "changed">;

/** JSON with keys in order: a drawing read back from the core is the same drawing whatever order its fields came in. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export const sameGraph = (a: FlowGraph, b: FlowGraph): boolean => stable(a) === stable(b);

/** Steps that are new in `after`, or whose settings or connections into them changed. Places don't count. */
export function freshSteps(before: FlowGraph, after: FlowGraph): Map<string, "new" | "changed"> {
  const into = (g: FlowGraph, id: string) =>
    stable(
      g.edges
        .filter((e) => e.target === id)
        .map((e) => `${e.source}>${e.when ?? ""}`)
        .sort(),
    );
  const fresh = new Map<string, "new" | "changed">();
  for (const n of after.nodes) {
    const was = before.nodes.find((b) => b.id === n.id);
    if (!was) fresh.set(n.id, "new");
    else if (stable(was) !== stable(n) || into(before, n.id) !== into(after, n.id)) fresh.set(n.id, "changed");
  }
  return fresh;
}

export type Take =
  /** Nothing to show: the editor already has this drawing. */
  | { kind: "same" }
  /** The owner changed the drawing here and hasn't saved it: theirs stays on the canvas. */
  | { kind: "keep" }
  /** Show the agent's drawing, marking what it added or changed. */
  | { kind: "take"; graph: FlowGraph; fresh: Fresh };

/**
 * What to do with an agent's saved drawing: `local` is what the canvas shows, `saved` the drawing it last saved or
 * loaded. Unsaved local edits are never replaced.
 */
export function takeAgentDraft(local: FlowGraph, saved: FlowGraph, incoming: FlowGraph): Take {
  if (sameGraph(incoming, local)) return { kind: "same" };
  if (!sameGraph(local, saved)) return { kind: "keep" };
  return { kind: "take", graph: incoming, fresh: freshSteps(local, incoming) };
}

/** The words sent to the agent: what the editor tells it first (which Flow, or that the owner changed it), then the owner's. */
export function askWords(words: string, notes: readonly (string | undefined)[]): string {
  const said = notes.filter(Boolean);
  return said.length ? `${said.join("\n")}\n\n${words}` : words;
}
