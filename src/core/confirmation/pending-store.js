// Pending confirmation store: in-memory map of unresolved confirmations.
//
// Each entry holds a Promise's resolve callback and a timeout timer.
// When the user responds (any channel), resolve() is called and the agent
// loop that was suspended at `await requestConfirmation(...)` resumes.
//
// No persistence needed: confirmations are ephemeral (30–120s window).
// If the daemon restarts, the agent runs that created them are also dead,
// so there is nothing to resume. Stale Telegram buttons simply won't find
// an entry and the handleCallbackQuery path shows "Expired" gracefully.

import { randomBytes } from "node:crypto";

function generateId() {
  return randomBytes(8).toString("hex"); // 16 hex chars, URL-safe
}

export class ConfirmationPendingStore {
  constructor() {
    // correlationId -> { resolve: (boolean) => void, timer: NodeJS.Timeout }
    this._pending = new Map();
  }

  /**
   * Register a new pending confirmation.
   *
   * Returns { correlationId, promise } where:
   *   - correlationId: embed in the reply (button callback_data, SSE event…)
   *   - promise: resolves to true (confirmed) or false (denied / timeout)
   *
   * After timeoutMs with no response the promise auto-resolves to false.
   */
  create({ timeoutMs = 30_000 } = {}) {
    const correlationId = generateId();

    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(correlationId);
        resolve(false);
      }, timeoutMs);
      this._pending.set(correlationId, { resolve, timer });
    });

    return { correlationId, promise };
  }

  /**
   * Resolve a pending confirmation.
   * Returns true if found and resolved, false if not found (timed out, already
   * resolved, or stale button after a process restart).
   */
  resolve(correlationId, value) {
    const entry = this._pending.get(correlationId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this._pending.delete(correlationId);
    entry.resolve(value);
    return true;
  }
}

// Singleton — one store per daemon process, shared by all adapters.
let _store = null;

export function getConfirmationStore() {
  if (!_store) _store = new ConfirmationPendingStore();
  return _store;
}
