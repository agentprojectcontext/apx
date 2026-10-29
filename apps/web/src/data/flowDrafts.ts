// Which Flows' saved drawings changed while the panel is open (the core's `flow.draft`: a draft an agent or another
// window saved, a draft published or discarded): a screen that shows one reads it again.
import { createStore, useSlice } from "./createStore.ts";

/** One change as the core told it: `by` is the agent whose tool saved it, null for the owner. */
export type FlowDraftChange = {
  flow: string;
  project: string;
  version: number | null;
  by: string | null;
  seq: number;
};
type State = { changed: Readonly<Record<string, number>>; any: number; last: FlowDraftChange | null };
const store = createStore<State>({ changed: {}, any: 0, last: null });

export function flowDraftChanged(change: Omit<FlowDraftChange, "seq">): void {
  store.set((s) => ({
    changed: { ...s.changed, [change.flow]: (s.changed[change.flow] ?? 0) + 1 },
    any: s.any + 1,
    last: { ...change, seq: s.any + 1 },
  }));
}

/** A number that grows each time this Flow's drawing changes: a dependency to read it again on. */
export const useFlowDraft = (flow: string): number => useSlice(store, (s) => s.changed[flow] ?? 0);
/** The same for any Flow: a list reads again when one is made or changed. */
export const useFlowsChanged = (): number => useSlice(store, (s) => s.any);
/** The newest change of any Flow, with who made it: the open editor takes an agent's. */
export const useLastFlowDraft = (): FlowDraftChange | null => useSlice(store, (s) => s.last);
