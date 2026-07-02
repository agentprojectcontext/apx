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
   * `guardActorId` (optional): when set, only resolve() calls that supply a
   * matching actorId may answer this confirmation. Channels where the reply is
   * visible to more than the initiator (a Telegram group's inline keyboard)
   * pass the initiator's id so a bystander can't approve someone else's action.
   * Channels whose transport is already 1:1/authenticated (web SSE + token,
   * terminal) leave it null and behave exactly as before.
   *
   * After timeoutMs with no response the promise auto-resolves to false.
   */
  create({ timeoutMs = 30_000, guardActorId = null } = {}) {
    const correlationId = generateId();
    const guard = guardActorId == null ? null : String(guardActorId);

    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(correlationId);
        resolve(false);
      }, timeoutMs);
      this._pending.set(correlationId, { resolve, timer, guardActorId: guard });
    });

    return { correlationId, promise };
  }

  /**
   * Is `actorId` allowed to answer this confirmation? True when the entry is
   * unknown (let resolve() report "expired"), unguarded, or the actor matches
   * the guard. Lets an adapter reject a bystander's press WITHOUT consuming the
   * pending entry, so the real initiator can still respond.
   */
  isActorAllowed(correlationId, actorId) {
    const entry = this._pending.get(correlationId);
    if (!entry) return true;
    if (entry.guardActorId == null) return true;
    return actorId != null && String(actorId) === entry.guardActorId;
  }

  /**
   * Resolve a pending confirmation.
   * Returns true if found and resolved, false if not found (timed out, already
   * resolved, stale button after a restart) OR if the entry is guarded and
   * `actorId` doesn't match — in the mismatch case the entry is preserved so
   * the authorized initiator can still answer.
   */
  resolve(correlationId, value, actorId) {
    const entry = this._pending.get(correlationId);
    if (!entry) return false;
    if (entry.guardActorId != null && (actorId == null || String(actorId) !== entry.guardActorId)) {
      return false;
    }
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
