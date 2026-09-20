// File an a2a peer's answer — or the fact that it never produced one.
//
// Two writers used to do this, and they disagreed. `POST /send` caught a dead
// engine and wrote `did not answer:` onto the thread. `send_to_agent` /
// `delegateToAgent` threw instead, so the inbound row was the last thing the
// ledger saw. Tools the peer DID run lived only in memory (`result.trace`, or
// the live `tool_result` events) and died with the exception: a rename, a
// telegram, a task — the work happened, the thread showed silence.
//
// One helper, both halves, success and failure. The trace rides on the reply
// row (not as its own `type: "tool"` lines) so the next turn does not eat it
// as conversation. Failure still throws after filing, so the caller sees the
// error; the owner sees the work.
import { CHANNELS } from "#core/constants/channels.js";
import { shortId } from "#core/util/ids.js";
import { summarizeToolTrace } from "#core/agent/tool-summary.js";
import { emitPeerTurnEvent } from "#core/events/bus.js";
import { a2aThreadId } from "#core/stores/messages.js";

/** Wrap an onEvent so every `tool_result` is kept even if the turn later throws. */
export function captureToolTrace(onEvent) {
  const trace = [];
  const wrapped = async (ev) => {
    if (ev?.type === "tool_result" && ev.trace) trace.push(ev.trace);
    if (typeof onEvent === "function") await onEvent(ev);
  };
  return { trace, onEvent: wrapped };
}

/**
 * Both halves of one utterance, the same shape `apx send --deliver` writes:
 * one row owned by the speaker, one by the recipient. That pairing is what
 * makes `listProjectA2AThreads` see a conversation rather than two monologues.
 */
export function fileA2AReply(project, {
  from,
  to,
  body,
  via,
  extraMeta = {},
  ts,
  failed = false,
  failureReason = null,
  model,
  usage,
  trace,
}) {
  const replyTs = ts || new Date().toISOString();
  const replyId = shortId("a2a");
  const toolSummary = summarizeToolTrace(trace);
  const meta = {
    to: from,
    ...(via ? { via } : {}),
    final: true,
    ...(failed ? { failed: true, failure_reason: failureReason || body } : {}),
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(Array.isArray(trace) && trace.length ? { trace } : {}),
    ...(toolSummary ? { tool_summary: toolSummary } : {}),
    ...extraMeta,
  };
  project.logMessage({
    agent_slug: to,
    channel: CHANNELS.A2A,
    direction: "out",
    type: "agent",
    actor_kind: "agent",
    actor_id: to,
    author: to,
    body,
    meta,
    ts: replyTs,
    external_id: replyId,
  });
  project.logMessage({
    agent_slug: from,
    channel: CHANNELS.A2A,
    direction: "in",
    author: to,
    body,
    meta: { from: to, ...(via ? { via } : {}) },
    ts: replyTs,
    external_id: replyId,
  });
  return { ts: replyTs, id: replyId };
}

/**
 * Run the peer, file whatever it produced — including the case where the
 * engine dies after tools already ran. Re-throws so the tool/route still
 * reports the failure; the thread is no longer empty when that happens.
 */
export async function runPeerAndFileReply({
  project,
  from,
  to,
  via,
  extraMeta,
  onEvent,
  replyFn,
  replyArgs,
}) {
  const narrator = narratePeerTurn({ project, from, to, signal: replyArgs?.signal || null });
  // `captureToolTrace` keeps the steps for the ledger; the narrator pushes the
  // SAME events out live. Both wrap whatever the caller passed, in that order,
  // so a caller that already watches (the a2a route's own onEvent) still does.
  const captured = captureToolTrace(narrator.wrap(onEvent));
  try {
    const result = await replyFn({
      ...replyArgs,
      signal: narrator.signal ?? replyArgs?.signal,
      onEvent: captured.onEvent,
    });
    const trace = Array.isArray(result?.trace) && result.trace.length
      ? result.trace
      : captured.trace;
    fileA2AReply(project, {
      from,
      to,
      via,
      extraMeta,
      body: result?.text || "",
      model: result?.model,
      usage: result?.usage,
      trace,
    });
    narrator.final({ text: result?.text || "", model: result?.model, usage: result?.usage });
    return { ...result, trace };
  } catch (e) {
    fileA2AReply(project, {
      from,
      to,
      via,
      extraMeta,
      body: `did not answer: ${e.message}`,
      failed: true,
      failureReason: e.message,
      trace: captured.trace,
    });
    narrator.error(e);
    throw e;
  } finally {
    narrator.end();
  }
}

/**
 * Tell every surface that this pair is talking, while it happens.
 *
 * The HTTP route wraps its peer run in `trackChannelTurn` and gets all of this
 * for free. The tool path could not: `trackChannelTurn` is daemon runtime and
 * core must not import upward (rule 8), so the same five steps travel as bus
 * phases that `host/daemon/events-ws.js` re-tells through the very same helper.
 *
 * It also carries an `abort`, and that is not decoration: `POST /jobs/:id/cancel`
 * stops a background job by pulling the abort hook of the a2a turn registered
 * under its thread. No tool-path turn was ever registered, so until now that
 * route closed the record and left the peer running.
 *
 * Never throws. Being watched is not worth failing a reply for — the same rule
 * the Telegram plugin applies to its own tracking hook.
 */
function narratePeerTurn({ project, from, to, signal = null }) {
  const noop = {
    signal: null,
    wrap: (fn) => fn,
    final: () => {},
    error: () => {},
    end: () => {},
  };
  if (!project || !from || !to) return noop;

  let ref;
  let ctrl;
  try {
    ref = shortId("a2aturn");
    // Chained, not replaced: a caller that already holds a signal (the blocking
    // tool path carries its sender's) keeps stopping this run, and Stop on the
    // thread now stops it too.
    ctrl = new AbortController();
    if (signal) {
      if (signal.aborted) ctrl.abort(signal.reason);
      else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
    }
    emitPeerTurnEvent({
      phase: "start",
      ref,
      project_id: project.id ?? null,
      channel: CHANNELS.A2A,
      thread_id: a2aThreadId(from, to),
      agent_slug: to,
      title: `${to} is answering ${from}`,
      abort: () => ctrl.abort(),
    });
  } catch {
    return noop;
  }

  let ended = false;
  const phase = (body) => {
    try { emitPeerTurnEvent({ phase: body.phase, ref, ...body }); }
    catch { /* a listener's problem, never the turn's */ }
  };
  return {
    signal: ctrl.signal,
    wrap: (fn) => async (ev) => {
      phase({ phase: "event", event: ev });
      if (typeof fn === "function") await fn(ev);
    },
    final: (result) => { phase({ phase: "final", result }); },
    error: (e) => {
      phase(ctrl.signal.aborted
        ? { phase: "aborted", result: {} }
        : { phase: "error", error: e?.message || String(e) });
    },
    end: () => {
      if (ended) return;
      ended = true;
      phase({ phase: "end" });
    },
  };
}
