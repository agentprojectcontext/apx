// Web / TUI confirmation adapter — async SSE + HTTP confirm endpoint.
//
// How the Promise resolves across two separate HTTP calls:
//
//   1. The agent loop (running inside an SSE request handler) calls
//      requestConfirmation(). This emits a "confirmation_required" SSE event
//      containing the correlationId and description, then suspends by awaiting
//      the pending store's Promise.
//
//   2. The browser / TUI receives the SSE event and renders a confirm/cancel
//      dialog. The dialog is keyed by correlationId.
//
//   3. The user responds → frontend POSTs to
//      POST /super-agent/confirm/:correlationId  { confirmed: boolean }
//
//   4. The API handler (api/confirm.js) calls pendingStore.resolve(correlationId,
//      value). This finds the in-memory resolve callback and calls it, unblocking
//      the agent loop. The SSE stream receives the next event and continues.
//
// `onEvent` is the SSE emitter for the current turn. It's injected at adapter
// creation time (each turn gets its own adapter instance) so the "please show
// a dialog" event reaches the right open SSE connection.

import { getConfirmationStore } from "../pending-store.js";

const TIMEOUT_MS = 120_000; // 2 min — humans on screens are slower than keyboard

/**
 * Factory — call once per SSE turn, passing the turn's `onEvent` emitter.
 *
 * @param {{ onEvent: (event: object) => Promise<void>|void }} opts
 * @returns {(tool: string, args: object, description: string) => Promise<boolean>}
 */
export function createWebConfirmAdapter({ onEvent }) {
  return async function requestConfirmation(tool, _args, description) {
    const store = getConfirmationStore();

    const { correlationId, promise } = store.create({ timeoutMs: TIMEOUT_MS });

    // Push a structured event to the open SSE stream so the frontend knows
    // to render a confirmation dialog. The correlationId is the shared key
    // between this pending promise and the POST /confirm/:correlationId call.
    await onEvent({
      type: "confirmation_required",
      correlationId,
      tool,
      description,
      timeout_ms: TIMEOUT_MS,
    });

    return promise;
  };
}
