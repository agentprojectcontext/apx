// Which Flows' saved drawings changed while the panel is open (the core's `flow.draft`: a draft an agent or another
// window saved, a draft published or discarded): a screen that shows one reads it again.
import { createStore, useSlice } from "./createStore.ts";

type State = { changed: Readonly<Record<string, number>>; any: number };
const store = createStore<State>({ changed: {}, any: 0 });

export function flowDraftChanged(flow: string): void {
  store.set((s) => ({ changed: { ...s.changed, [flow]: (s.changed[flow] ?? 0) + 1 }, any: s.any + 1 }));
}

/** A number that grows each time this Flow's drawing changes: a dependency to read it again on. */
export const useFlowDraft = (flow: string): number => useSlice(store, (s) => s.changed[flow] ?? 0);
/** The same for any Flow: a list reads again when one is made or changed. */
export const useFlowsChanged = (): number => useSlice(store, (s) => s.any);
