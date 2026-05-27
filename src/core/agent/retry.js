// Classify engine errors as retryable (advance the fallback chain) or fatal
// (surface to the user). The chain advances on transient / provider-side
// issues; bad auth / bad payload stay fatal so the user actually fixes them.
//
// Tracked by spec/backlog/13-lazy-retry-on-engine-failure.md.

/**
 * Signals that intercepting this error and trying the next model in the
 * fallback chain is the right move.
 *
 * Match shape: errors thrown by engine adapters look like
 *   "groq 413: Request too large for model `qwen3-32b` ..."
 *   "openrouter 429: ..."
 *   "anthropic 529: overloaded"
 *   "ollama 500: model timeout"
 * — i.e. "<provider> <status>: <text>". We classify by status code and a
 * permissive set of message tokens; anything ambiguous defaults to NOT
 * retryable so we don't silently swap on real bugs.
 */
const RETRYABLE_STATUS = new Set([413, 429, 500, 502, 503, 504, 529]);

const RETRYABLE_PHRASES = [
  /rate.?limit/i,
  /request too large/i,
  /tokens per minute/i,
  /TPM/,
  /overloaded/i,
  /upstream.*\b(timeout|error)\b/i,
  /provider returned error/i,
  /try again/i,
  /service unavailable/i,
  /connection reset/i,
  /timeout/i,
];

const FATAL_STATUS = new Set([400, 401, 403, 404, 422]);

const FATAL_PHRASES = [
  /no api_key/i,
  /invalid.*api.*key/i,
  /authentication/i,
  /unauthorized/i,
  /forbidden/i,
  /not.?found/i,
];

export function isRetryableEngineError(err) {
  const msg = String(err?.message || err || "");
  if (!msg) return false;

  // Parse "<provider> <status>: ..." style
  const m = /\b(\d{3})\b/.exec(msg);
  const status = m ? parseInt(m[1], 10) : null;

  if (status && FATAL_STATUS.has(status)) {
    // 400 is the tricky one — Groq emits 400 for malformed tools as well as
    // for "Failed to call a function". The former is our bug, the latter is
    // a model quality issue we want to retry past. Heuristic: if the message
    // mentions "tools." or "schema" → bug → fatal; if it mentions "function"
    // → model couldn't pick a tool → retry on a different model.
    if (status === 400) {
      if (/failed to call a function|did not produce a (valid )?tool/i.test(msg)) return true;
      // explicit schema / param errors are our bug, not transient
      return false;
    }
    return false;
  }
  if (status && RETRYABLE_STATUS.has(status)) return true;

  // No status code parsed — fall back to phrase matching.
  if (FATAL_PHRASES.some((re) => re.test(msg))) return false;
  if (RETRYABLE_PHRASES.some((re) => re.test(msg))) return true;
  return false;
}

/**
 * Short, human-readable reason for the log line. Strips noisy URLs and
 * tokens-per-minute math so the message is scannable.
 */
export function shortRetryReason(err) {
  const raw = String(err?.message || err || "");
  // Strip everything after the first newline / "Upgrade to ..." marketing.
  const head = raw.split(/\n|Upgrade to|See 'failed_generation'|https?:\/\//)[0].trim();
  return head.slice(0, 220);
}
