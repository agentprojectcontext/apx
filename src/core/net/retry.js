// Retrying a request that never reached the server — and only that.
//
// 2026-09-23 08:33: api.telegram.org was unreachable for about a minute. The
// daemon's own polling backed off and recovered; a routine's delivery made one
// attempt, lost the morning summary, and filed the run as an error.
//
// The line that matters is WHERE it failed. A request that never connected
// (DNS, refused, connect timeout, unreachable network) is safe to send again:
// nothing was delivered. One that connected and then lost its answer (headers
// timeout, reset mid-response) may already have been acted on — resending it
// is how one message becomes two. Those are NOT retried here.

// undici / Node error codes for "the request never left".
const CONNECT_PHASE_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENETDOWN",
]);

function codesOf(err) {
  const out = [];
  let e = err;
  // `fetch failed` wraps the real error in `cause`, sometimes twice
  // (AggregateError from happy-eyeballs carries `errors`).
  for (let i = 0; e && i < 4; i++) {
    if (e.code) out.push(e.code);
    if (Array.isArray(e.errors)) for (const inner of e.errors) if (inner?.code) out.push(inner.code);
    e = e.cause;
  }
  return out;
}

/** True when the request provably never reached the server. */
export function isConnectFailure(err) {
  return codesOf(err).some((c) => CONNECT_PHASE_CODES.has(c));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying it while it fails at the connect phase. Any other failure
 * is thrown at once. `delaysMs` is the wait before each retry.
 */
export async function withConnectRetry(fn, { delaysMs = [2000, 8000], sleepFn = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= delaysMs.length || !isConnectFailure(e)) throw e;
      await sleepFn(delaysMs[attempt]);
    }
  }
}
