import { z } from "zod";
import { FlowDraftGraph, FlowGraphDocument } from "./flow-graph.ts";

const FlowId = z.string().min(1).max(100);
const Entry = z.number().int().min(1);

/**
 * A save that changed a Flow's drawing (DECISIONS.md#d-179): `draft` saved, `published` (what runs from then on) or
 * `restored` from an earlier entry. `by`: the agent whose tool saved it, null for the owner.
 */
export const FlowHistoryEntry = z
  .object({
    entry: Entry,
    at: z.string(),
    kind: z.enum(["draft", "published", "restored"]),
    by: z.string().nullable(),
    /** The agent's name, when it still exists. */
    byName: z.string().nullable(),
    /** The entry a restore brought back. */
    restoredFrom: Entry.nullable(),
    /** The revision new events ran from a published entry on. */
    revision: z.number().int().min(1).nullable(),
    steps: z.number().int().min(0),
  })
  .strict();
export type FlowHistoryEntry = z.infer<typeof FlowHistoryEntry>;

/**
 * A Flow's history, newest first. Reading it is open to whoever reaches the Flow (the owner, an agent's own tool in its
 * project); bringing an entry back is the owner's, and never publishes.
 */
export const flowHistoryMethods = {
  "flows.history": {
    params: z.object({ flow: FlowId }).strict(),
    result: z.object({ entries: z.array(FlowHistoryEntry) }).strict(),
    effect: false,
  },
  "flows.history_get": {
    params: z.object({ flow: FlowId, entry: Entry }).strict(),
    result: z.object({ entry: FlowHistoryEntry, graph: FlowDraftGraph }).strict(),
    effect: false,
  },
  /** The entry's drawing becomes the draft; what runs stays as it is until the owner saves it. */
  "flows.history_restore": {
    params: z
      .object({
        flow: FlowId,
        entry: Entry,
        expectedVersion: z.number().int().min(1).nullable(),
        confirm: z.literal(true),
      })
      .strict(),
    result: FlowGraphDocument,
    effect: true,
    access: "human",
  },
} as const;
