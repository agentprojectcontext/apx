// In-progress chat turns, so streaming survives the tab that started it.
//
// The per-request NDJSON stream belongs to the sender: refresh the page or walk
// to another chat and it is gone, even though the turn keeps running on the
// daemon. This registry is the daemon's own record of what is being written
// right now — the accumulated text plus who/where — so ANY surface can be caught
// up (via the conversation GET) and then followed live (via the events-ws
// "turn" frames the chat handlers broadcast).
//
// It is in-memory runtime state, and it used to say "if the daemon restarts
// mid-turn the turn is gone anyway" — which was true, and was the bug. A
// restart now DRAINS (drainActiveTurns), so a turn that can finish does; and
// whatever still has to be cut is written to disk on the way out
// (core/stores/resumable-turns.js) so the next daemon can pick it up instead of
// finding a mid-sentence message and no idea what produced it.
//
// Key is the conversation's identity as the client already addresses it:
//   project agent  → `${projectId}:conv:${conversationId}`
//   super-agent    → `${projectId}:thread:${channel}:${threadId}`
// so a client on that conversation can match a frame without extra plumbing.

import { DRAIN_MS, SETTLE_MS } from "#core/constants/shutdown.js";
import { saveResumableTurns } from "#core/stores/resumable-turns.js";

let seq = 0;
const byId = new Map();  // turnId -> record
const byKey = new Map(); // key -> turnId  (the latest turn on that conversation)
// Called when a turn ends, so a drain notices immediately instead of polling.
const drainWaiters = new Set();

/** Public client shape. Abort hooks and internal keys never leave this module. */
function publicTurn(rec) {
  if (!rec) return null;
  return {
    turn_id: rec.id,
    text: rec.text,
    project_id: rec.project_id ?? null,
    agent_slug: rec.agent_slug,
    conversation_id: rec.conversation_id,
    channel: rec.channel,
    thread_id: rec.thread_id,
    model: rec.model,
    started_at: rec.started_at,
    // The text alone is not enough to re-open a multi-step turn: it loses the
    // actual tools and makes a still-working turn look idle. Keep the compact,
    // render-ready timeline alongside it; abort hooks and private keys remain
    // inside this module.
    ...(rec.parts?.length
      ? {
          parts: rec.parts.map((part) => {
            const copy = { ...part };
            if (copy.streaming === false) delete copy.streaming;
            return copy;
          }),
        }
      : {}),
  };
}

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

/** Key for a code-session turn. A code session is addressed by (project, id)
 *  and by nothing else — the SAME session is driven from the web panel
 *  (`web_code`) and from `apx exec --code` (`code`), so keying it by channel
 *  would let the panel's Stop miss a turn the terminal started, and vice
 *  versa. The session id is the thread here. */
export function codeTurnKey(projectId, sessionId) {
  return `${projectId}:code:${sessionId}`;
}

/** Begin tracking a turn. `meta` is echoed to clients (agent_slug, model, …),
 *  except `abort`: a function that stops the run, kept private to this module
 *  and to abortActiveTurn. */
export function startActiveTurn(key, meta = {}) {
  const id = `turn_${Date.now().toString(36)}_${++seq}`;
  const rec = { id, key, text: "", started_at: new Date().toISOString(), ...meta, parts: [] };
  byId.set(id, rec);
  byKey.set(key, id);
  return rec;
}

function syncText(rec) {
  rec.text = rec.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text || "")
    .join("");
}

/** Grow the accumulated text as tokens arrive. */
export function appendActiveTurn(id, delta) {
  const rec = byId.get(id);
  if (!rec || !delta) return;
  const last = rec.parts.at(-1);
  if (last?.kind === "text" && last.streaming) last.text += delta;
  else rec.parts.push({ kind: "text", text: delta, streaming: true });
  syncText(rec);
}

/** Record the visible work timeline of a live turn. This is deliberately a
 * small transport shape: text segments plus tool starts/results, never hidden
 * reasoning or the abort hook. A refresh can therefore show the same tools the
 * original pane was watching. */
export function recordActiveTurnEvent(id, event) {
  const rec = byId.get(id);
  if (!rec || !event) return;
  if (event.type === "assistant_text" && event.text) {
    const last = rec.parts.at(-1);
    if (last?.kind === "text" && last.streaming) {
      last.text = event.text;
      last.streaming = false;
    } else {
      rec.parts.push({ kind: "text", text: event.text });
    }
    syncText(rec);
    return;
  }
  if (event.type === "tool_start" && event.trace?.id) {
    rec.parts.push({
      kind: "tool",
      id: event.trace.id,
      tool: event.trace.tool || "tool",
      args: event.trace.args,
      status: "running",
    });
    return;
  }
  if (event.type === "tool_result" && event.trace?.id) {
    const failed = !!event.trace.result && typeof event.trace.result === "object" && !!event.trace.result.error;
    const part = rec.parts.findLast((item) => item.kind === "tool" && item.id === event.trace.id);
    if (part) {
      part.result = event.trace.result;
      part.status = failed ? "error" : "done";
    } else {
      rec.parts.push({
        kind: "tool",
        id: event.trace.id,
        tool: event.trace.tool || "tool",
        args: event.trace.args,
        result: event.trace.result,
        status: failed ? "error" : "done",
      });
    }
  }
}

/** Is this one of the events the visible timeline is made of?
 *
 * The same answer has to serve two surfaces or they drift: the record kept for
 * a client that RE-OPENS a turn mid-run (recordActiveTurnEvent, above) and the
 * frames pushed to a client that FOLLOWS one over the feed. They used to
 * disagree — the record kept the tools, the feed carried only tokens — so
 * walking to another chat and back turned a multi-step turn into one growing
 * paragraph with the work erased. One predicate, both paths.
 */
export function isVisibleTurnEvent(event) {
  if (!event) return false;
  if (event.type === "assistant_text") return !!event.text;
  return (event.type === "tool_start" || event.type === "tool_result") && !!event.trace?.id;
}

/** Stop tracking. Idempotent — the finally block and an error path both call it. */
export function endActiveTurn(id) {
  const rec = byId.get(id);
  if (!rec) return;
  byId.delete(id);
  if (byKey.get(rec.key) === id) byKey.delete(rec.key);
  // A drain in progress is waiting on exactly this. Notified rather than
  // polled, so a shutdown with one short turn left costs that turn's remaining
  // milliseconds and not a poll interval.
  for (const notify of [...drainWaiters]) {
    try { notify(); } catch { /* a waiter that throws must not break endActiveTurn */ }
  }
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

/**
 * Abort every live turn. Returns how many had an abort hook to pull.
 *
 * For shutdown. A turn is in-memory state and dies with the process either way
 * — but a turn that is ABORTED runs its own catch first, and that catch already
 * writes whatever streamed into the ledger, the same way Stop does. Without
 * this, `apx restart` in the middle of an answer threw the work away silently:
 * no partial in the thread, no trace of the tools that had really run, and the
 * next turn with no idea any of it happened. Aborting on the way out turns a
 * message that vanishes into a message that stops mid-sentence and is still
 * there — which is what the reader can act on.
 *
 * It does NOT resume the turn after the restart. That needs the run's state on
 * disk, not just its text.
 *
 * Prefer drainActiveTurns() on the shutdown path: cutting a turn off is the
 * fallback, not the first move.
 */
export function abortAllActiveTurns() {
  let n = 0;
  for (const key of [...byKey.keys()]) {
    if (abortActiveTurn(key)) n++;
  }
  return n;
}

/**
 * Let the turns already running finish, then cut off whatever is left.
 *
 * This is the shutdown path's first move, and it exists because aborting was
 * never the goal — it was the only thing available. A turn that is cut off
 * survives as a message ending mid-sentence, which is strictly better than one
 * that vanishes, but it is still a turn that did not get to say what it had to
 * say. Most turns are a few seconds long: given ten of them, they simply
 * finish, and `apx restart` in the middle of an answer costs nothing at all.
 *
 * Three properties worth keeping:
 *
 *  - **A quiet shutdown does not wait.** Nothing in flight resolves on the
 *    spot, so the ordinary restart is exactly as fast as it was before.
 *  - **It waits for the turns that were running WHEN IT STARTED**, not for
 *    whatever arrives meanwhile. The daemon is still serving while it drains,
 *    and a steady trickle of new turns would otherwise hold the drain open for
 *    its full ceiling every time. New arrivals still get aborted at the end —
 *    they just do not extend the wait.
 *  - **The stragglers get SETTLE_MS after the abort.** The abort begins a
 *    write; each turn's catch persists what it streamed. Exiting the instant we
 *    abort would discard the very thing the abort is for.
 *
 * @returns {Promise<{waited: boolean, finished: number, aborted: number}>}
 *   `finished` ran to completion on their own, `aborted` had to be cut.
 */
/**
 * The live record as the next daemon needs to read it.
 *
 * The split between `effects` and `in_flight` is the whole judgement call here,
 * and it is a split between what we KNOW and what we only suspect.
 *
 *  - `effects` are tool calls with a result: they ran, they finished, the world
 *    changed. These seed the resumed turn's side-effect ledger, which makes
 *    repeating them mechanically impossible.
 *  - `in_flight` are calls that had started and had NOT come back when the
 *    process was cut. Nobody knows whether that WhatsApp left. Seeding one
 *    would tell the resumed turn "already done" about something that may never
 *    have happened — trading a duplicate message for a lost one, silently.
 *
 * So in-flight calls are deliberately NOT seeded; they are named in the resume
 * prompt instead, for the model to verify before redoing. This is the one place
 * where asking is better than enforcing: the machine genuinely does not know
 * the answer, and the agent can go and look.
 */
function resumableFrom(rec) {
  const tools = (rec.parts || []).filter((part) => part.kind === "tool");
  return {
    turn_id: rec.id,
    project_id: rec.project_id ?? null,
    agent_slug: rec.agent_slug ?? null,
    conversation_id: rec.conversation_id ?? null,
    channel: rec.channel ?? null,
    thread_id: rec.thread_id ?? null,
    model: rec.model ?? null,
    surface: rec.surface ?? null,
    prompt: rec.prompt ?? "",
    partial_text: rec.text || "",
    effects: tools
      .filter((part) => part.status !== "running")
      .map((part) => ({ tool: part.tool, args: part.args, result: part.result })),
    in_flight: tools
      .filter((part) => part.status === "running")
      .map((part) => ({ tool: part.tool, args: part.args })),
    started_at: rec.started_at,
    cut_at: new Date().toISOString(),
  };
}

export function drainActiveTurns({ timeoutMs = DRAIN_MS, settleMs = SETTLE_MS } = {}) {
  const pending = new Set(byId.keys());
  const total = pending.size;
  if (!total) return Promise.resolve({ waited: false, finished: 0, aborted: 0, resumable: 0 });

  return new Promise((resolve) => {
    let settled = false;

    const prune = () => {
      for (const id of pending) if (!byId.has(id)) pending.delete(id);
      return pending.size;
    };

    const finish = () => {
      if (settled) return;
      const left = prune();
      settled = true;
      clearTimeout(timer);
      drainWaiters.delete(onTurnEnd);
      const finished = total - left;
      // Write down what is about to be cut, BEFORE cutting it.
      //
      // Deliberately here and not in abortActiveTurn, which is the same
      // machinery: a turn the USER stopped must not come back from the dead at
      // the next restart. Only a turn the daemon cut off against its will is a
      // turn anybody wants resumed.
      let resumable = 0;
      try {
        resumable = saveResumableTurns([...byId.values()].map(resumableFrom));
      } catch {
        /* never let the bookkeeping stop the abort below — the partial matters more */
      }
      // Unconditionally, and over everything still live rather than over the
      // snapshot: a turn that arrived mid-drain has a partial worth keeping
      // too. Gating this on the snapshot having stragglers was a bug — the
      // common shape (the watched turn finishes, a routine fires meanwhile)
      // resolves with the snapshot empty, and that turn would have been
      // dropped by the exit with nothing written.
      const aborted = abortAllActiveTurns();
      if (!aborted) return resolve({ waited: true, finished, aborted: 0, resumable });
      // Deliberately NOT unref'd: this is the wait, and a timer that does not
      // hold the loop open is a wait the process can walk out of.
      setTimeout(() => resolve({ waited: true, finished, aborted, resumable }), settleMs);
    };

    const onTurnEnd = () => { if (!prune()) finish(); };

    const timer = setTimeout(finish, timeoutMs);
    drainWaiters.add(onTurnEnd);
    onTurnEnd(); // a turn may have ended between the snapshot and the wiring
  });
}

/** The turn currently being written on that conversation, if any — the partial
 *  a just-arrived client renders before it starts following the live frames. */
export function getActiveTurnByKey(key) {
  const id = byKey.get(key);
  const rec = id ? byId.get(id) : null;
  return publicTurn(rec);
}

/** Every live turn, optionally scoped to one project. Used by aggregate list
 *  surfaces (Inbox / Chats) so they all render the same daemon-owned status. */
export function listActiveTurns({ projectId } = {}) {
  const want = projectId === undefined || projectId === null ? null : String(projectId);
  return [...byId.values()]
    .filter((rec) => want === null || String(rec.project_id) === want)
    .map(publicTurn);
}
