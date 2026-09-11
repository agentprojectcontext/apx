// What a turn did that the transcript will not remember.
//
// A few of the events a turn emits are decisions ABOUT the run rather than
// parts of it: an engine fell over and the chain moved on, tools were
// suppressed, the router landed somewhere other than first choice. None of them
// is persisted — they do not reach the ledger, and the panel renders them as a
// note on a bubble that is gone on the next reload. So the log is the only
// place they survive, and a route that does not write them here is a route
// whose failures cannot be explained after the fact.
//
// WHY THIS FILE EXISTS. It lived inside `api/super-agent.js`, which meant only
// the super-agent had it — Telegram had its own copy, and the project-agent
// (`exec.js`), a2a (`conversations.js`) and group (`groups.js`) paths had
// nothing. On 2026-09-11 a project agent's turn fell from `zen:big-pickle` to
// `gemini:gemini-3.5-flash-lite` and there was no record anywhere of why: not
// in the ledger, not in the daemon log, and the bubble's note carried the
// fallback without the reason. Answering "why did big-pickle fail?" needed a
// hand-written HTTP call to the provider (it was `429 FreeUsageLimitError` — an
// account quota, not a bug). One shared logger, so every chat route explains
// itself the same way.
import { loggerFor } from "#core/logging.js";

const log = loggerFor("turn");

/**
 * Write the run-level decisions in one event to the log. Everything else is
 * ignored, so a caller can hand it every event without filtering first.
 *
 * @param {object} event   one stream event
 * @param {object} ctx     `{ trace_id, channel, agent }` — whatever the caller has
 */
export function logTurnEvent(event, ctx = {}) {
  if (!event) return;
  if (event.type === "engine_failed") {
    // The REASON is the whole point. Without it this line says an engine failed
    // and leaves the reader exactly where they were.
    log.warn(
      `engine ${event.model || "?"} failed → retrying with ${event.retry_with || "end of chain"}`,
      { ...ctx, reason: event.reason },
    );
    return;
  }
  if (event.type === "tools_suppressed") {
    log.info(`tools suppressed: ${(event.tools || []).join(", ")} (${event.reason || "?"})`, ctx);
    return;
  }
  if (event.type === "model_routed" && event.from_fallback) {
    log.info(`model routing fell back: ${event.model} (provider=${event.provider})`, ctx);
  }
}

/**
 * Wrap an `onEvent` so it logs on the way through. Returns a function with the
 * same shape, so a route can drop it in where it already passes one.
 *
 * `onEvent` may be null — a route that only wants the logging (a background run
 * with nobody streaming) passes nothing and still gets the record.
 */
export function withTurnLog(onEvent, ctx = {}) {
  return (event) => {
    logTurnEvent(event, ctx);
    if (onEvent) onEvent(event);
  };
}
