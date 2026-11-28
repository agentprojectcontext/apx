// Voice calls with an agent (packages/protocol/src/call-methods.ts): what the first screen needs to know of
// them. Whether calls can run here and the card that places and holds one load late (call/).
import type { CallMode, CallStatus } from "@apx/protocol";
import { createStore, useSlice } from "./createStore.ts";

type CallState = {
  /** What calls.status said last; unknown until the first answer. */
  status?: CallStatus | undefined;
  /**
   * The call card is on screen: `agent` is who it calls (the super-agent when none), `thread` the call it goes on in
   * (calling again from a call's chat), `mode` `quick` when the owner said the voice's name: it starts on its own.
   * `greetedUntil`: this computer already greeted the owner, and its microphone waits until then (ms) so the call
   * does not hear the greeting.
   */
  card?: CallTarget | undefined;
  /** The call going on from this panel, once its thread exists. */
  live?: string | undefined;
};

type CallTarget = {
  agent?: string | undefined;
  thread?: string | undefined;
  mode?: CallMode | undefined;
  greetedUntil?: number | undefined;
};

export const calls = createStore<CallState>({});

export const useCalls = <T>(select: (s: CallState) => T): T => useSlice(calls, select);

/** Opens the call card: a new call with `agent`, or (`thread`) the same call's chat again. */
export function openCall(target: CallTarget = {}): void {
  calls.set({
    card: { agent: target.agent, thread: target.thread, mode: target.mode, greetedUntil: target.greetedUntil },
  });
}

/**
 * What goes with calls besides the card: `elsewhere`, a call this panel did not place (on the phone, in another
 * window); `quiet`, none anywhere, so this computer may listen for the voice's name.
 */
export const callScene = (s: CallState): "elsewhere" | "quiet" | undefined =>
  s.card || s.live ? undefined : s.status?.live ? "elsewhere" : "quiet";
