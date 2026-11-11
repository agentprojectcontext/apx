// Voice calls with the super-agent (packages/protocol/src/call-methods.ts): what the first screen needs to know of
// them. Whether calls can run here and the card that places and holds one load late (call/).
import type { CallStatus } from "@apx/protocol";
import { createStore, useSlice } from "./createStore.ts";

type CallState = {
  /** What calls.status said last; unknown until the first answer. */
  status?: CallStatus | undefined;
  /** The call card is on screen; `thread` is the call it goes on in (calling again from a call's chat). */
  card?: { thread?: string | undefined } | undefined;
  /** The call going on from this panel, once its thread exists. */
  live?: string | undefined;
};

export const calls = createStore<CallState>({});

export const useCalls = <T>(select: (s: CallState) => T): T => useSlice(calls, select);

/** Opens the call card: a new call, or (`thread`) the same call's chat again. */
export function openCall(thread?: string): void {
  calls.set({ card: { thread } });
}
