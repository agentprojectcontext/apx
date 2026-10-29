// What the editor asks of each step before a drawing can run; a draft keeps steps either way (DECISIONS.md#d-177).
import { flowStepGap } from "@apx/protocol/flow-complete";
import type { FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { ownTable } from "./values.ts";

/**
 * What a step still needs before its drawing can run, the core's rule (`flowStepGap`), and a table chosen for a read or
 * a save: the editor shows no Flow-own table but the one an old definition was drawn with. Undefined when complete.
 */
export function stepGap(n: FlowNode): string | undefined {
  if ((n.kind === "table_read" || n.kind === "table_write") && !n.table && !ownTable(n)) return "table";
  return flowStepGap(n);
}
/** A step that keeps a drawing from running yet; a draft may still keep it (DECISIONS.md#d-177). */
export const blank = (n: FlowNode): boolean => stepGap(n) !== undefined;
