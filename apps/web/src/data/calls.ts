// Voice calls with an agent (packages/protocol/src/call-methods.ts): what the first screen needs to know of
// them. Whether calls can run here and the card that places and holds one load late (call/).
import type { CallStatus } from "@apx/protocol";
import { createStore, useSlice } from "./createStore.ts";

type CallState = {
  /** What calls.status said last; unknown until the first answer. */
  status?: CallStatus | undefined;
  /**
   * The call card is on screen: `agent` is who it calls (the super-agent when none), `thread` the call it goes on in
   * (calling again from a call's chat).
   */
  card?: { agent?: string | undefined; thread?: string | undefined } | undefined;
  /** The call going on from this panel, once its thread exists. */
  live?: string | undefined;
};

export const calls = createStore<CallState>({});

export const useCalls = <T>(select: (s: CallState) => T): T => useSlice(calls, select);

/** Opens the call card: a new call with `agent`, or (`thread`) the same call's chat again. */
export function openCall(target: { agent?: string | undefined; thread?: string | undefined } = {}): void {
  calls.set({ card: { agent: target.agent, thread: target.thread } });
}
