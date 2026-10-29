// What the core says about Flow tests and runs while the panel is open (`flow.test`, `flow.run`, DECISIONS.md#d-178):
// the editor follows its test, a Flow's page reads its runs again as they move. Ids and states only.
import type { CoreEvent } from "@apx/protocol";
import { createStore, useSlice } from "./createStore.ts";

export type FlowTestHeard = Extract<CoreEvent, { type: "flow.test" }> & { seq: number };
export type FlowRunMoved = Extract<CoreEvent, { type: "flow.run" }> & { seq: number };
type State = {
  tests: Readonly<Record<string, FlowTestHeard>>;
  runs: Readonly<Record<string, FlowRunMoved>>;
  seq: number;
};
const store = createStore<State>({ tests: {}, runs: {}, seq: 0 });

export function flowTestHeard(ev: Extract<CoreEvent, { type: "flow.test" }>): void {
  store.set((s) => ({ seq: s.seq + 1, tests: { ...s.tests, [ev.flow]: { ...ev, seq: s.seq + 1 } } }));
}
export function flowRunMoved(ev: Extract<CoreEvent, { type: "flow.run" }>): void {
  store.set((s) => ({ seq: s.seq + 1, runs: { ...s.runs, [ev.flow]: { ...ev, seq: s.seq + 1 } } }));
}

/** The last thing this Flow's test did: waiting, stopped, out of time, an event in. */
export const useFlowTestHeard = (flow: string | undefined): FlowTestHeard | undefined =>
  useSlice(store, (s) => (flow ? s.tests[flow] : undefined));
/** The last move of one of this Flow's runs. */
export const useFlowRunMoved = (flow: string | undefined): FlowRunMoved | undefined =>
  useSlice(store, (s) => (flow ? s.runs[flow] : undefined));
