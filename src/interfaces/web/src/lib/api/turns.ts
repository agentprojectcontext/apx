import { http } from "../http";

// Stopping a turn that is already running.
//
// Closing the NDJSON stream does NOT stop the run — that is deliberate, it is
// what lets a refresh or a second tab catch up on a turn in progress. So
// cancelling has to be asked for out loud. Address the turn the way you already
// address its thread: a project agent by conversation, Roby by channel (its
// thread IS the channel).
//
// `aborted: false` is not a failure — the turn may simply have finished a moment
// before the request landed. A caller interrupting in order to send should carry
// on and send either way.
export const Turns = {
  abort: (
    pid: string | number,
    target: { conversation_id?: string; channel?: string },
  ) => http.post<{ ok: boolean; aborted: boolean }>(`/api/projects/${pid}/turns/abort`, target),
};
