// In-progress chat turns, so streaming survives the tab that started it.
//
// The per-request NDJSON stream belongs to the sender: refresh the page or walk
// to another chat and it is gone, even though the turn keeps running on the
// daemon. This registry is the daemon's own record of what is being written
// right now — the accumulated text plus who/where — so ANY surface can be caught
// up (via the conversation GET) and then followed live (via the events-ws
// "turn" frames the chat handlers broadcast). It is pure in-memory runtime
// state: if the daemon restarts mid-turn the turn is gone anyway.
//
// Key is the conversation's identity as the client already addresses it:
//   project agent  → `${projectId}:conv:${conversationId}`
//   super-agent    → `${projectId}:thread:${channel}:${threadId}`
// so a client on that conversation can match a frame without extra plumbing.

let seq = 0;
const byId = new Map();  // turnId -> record
const byKey = new Map(); // key -> turnId  (the latest turn on that conversation)

/** Key for a project-agent conversation turn. */
export function convTurnKey(projectId, conversationId) {
  return `${projectId}:conv:${conversationId}`;
}
/** Key for a super-agent channel-thread turn. */
export function threadTurnKey(projectId, channel, threadId) {
  return `${projectId}:thread:${channel}:${threadId}`;
}
/** Key for a super-agent chat turn. Roby's web chat has no conversation id —
 *  its thread IS the channel (the ledger is written per channel+day), so there
 *  is one live turn per project+channel, exactly as Telegram keys one live turn
 *  per chat_id. */
export function superAgentTurnKey(projectId, channel) {
  return `${projectId}:sa:${channel}`;
}

/** Begin tracking a turn. `meta` is echoed to clients (agent_slug, model, …),
 *  except `abort`: a function that stops the run, kept private to this module
 *  and to abortActiveTurn. */
export function startActiveTurn(key, meta = {}) {
  const id = `turn_${Date.now().toString(36)}_${++seq}`;
  const rec = { id, key, text: "", started_at: new Date().toISOString(), ...meta };
  byId.set(id, rec);
  byKey.set(key, id);
  return rec;
}

/** Grow the accumulated text as tokens arrive. */
export function appendActiveTurn(id, delta) {
  const rec = byId.get(id);
  if (rec && delta) rec.text += delta;
}

/** Stop tracking. Idempotent — the finally block and an error path both call it. */
export function endActiveTurn(id) {
  const rec = byId.get(id);
  if (!rec) return;
  byId.delete(id);
  if (byKey.get(rec.key) === id) byKey.delete(rec.key);
}

/**
 * Stop the turn running on that conversation. Returns false when there is
 * nothing to stop — no live turn, or one registered without an abort hook.
 *
 * This is what makes "stop" and "interrupt" real. A client closing its NDJSON
 * socket deliberately does NOT end the run (that is what lets a refresh catch
 * up on it), so cancelling has to be said out loud: the surface asks for it,
 * the run's AbortController is signalled here, and the loop notices at its next
 * iteration boundary. Same shape Telegram has had all along — one controller
 * per live conversation, aborted when a newer message says "no, do this
 * instead" (see core/channels/telegram/dispatch.js).
 */
export function abortActiveTurn(key) {
  const id = byKey.get(key);
  const rec = id ? byId.get(id) : null;
  if (!rec || typeof rec.abort !== "function") return false;
  rec.aborted = true;
  try {
    rec.abort();
  } catch {
    /* the run is already gone; the caller only needs to know we tried */
  }
  return true;
}

/** The turn currently being written on that conversation, if any — the partial
 *  a just-arrived client renders before it starts following the live frames. */
export function getActiveTurnByKey(key) {
  const id = byKey.get(key);
  const rec = id ? byId.get(id) : null;
  if (!rec) return null;
  return { turn_id: rec.id, text: rec.text, agent_slug: rec.agent_slug, model: rec.model, started_at: rec.started_at };
}
