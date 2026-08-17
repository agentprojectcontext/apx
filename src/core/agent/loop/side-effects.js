// Remembers which world-changing tool calls a turn already made.
//
// Weaker models (Gemini especially) re-emit the SAME tool call across
// iterations — send_telegram three times with identical args, spamming the
// user. For tools that mutate something we record the (name + args) signature
// and answer a repeat with a synthetic "already done" instead of running it
// again. Read-only tools are exempt: they are idempotent and are legitimately
// repeated (list_tasks before and after a change).
//
// This is a user-facing protection, and it used to live as two loose locals
// inside runAgent alongside eleven other concerns, keyed off an inline array of
// tool-name literals. The names now come from tools/names.js (see
// SIDE_EFFECT_TOOLS) and the ledger is its own object, so both halves can be
// tested without driving a whole agent turn.
import { SIDE_EFFECT_TOOLS } from "../tools/names.js";

/**
 * @returns {{
 *   signature(name: string, args: unknown): string|null,
 *   seen(sig: string|null): boolean,
 *   previous(sig: string): unknown,
 *   record(sig: string|null, result: unknown): void,
 * }}
 *   `signature` returns null for read-only tools, which callers treat as
 *   "never dedupe this".
 */
export function createSideEffectLedger() {
  const executed = new Map();

  return {
    signature(name, args) {
      if (!SIDE_EFFECT_TOOLS.has(name)) return null;
      try {
        return `${name}:${JSON.stringify(args)}`;
      } catch {
        // Circular or otherwise unserializable args: fall back to the tool
        // name alone. Deduping slightly too eagerly is safer than sending the
        // same message twice.
        return `${name}:<unserializable>`;
      }
    },
    seen(sig) {
      return sig != null && executed.has(sig);
    },
    previous(sig) {
      return executed.get(sig);
    },
    record(sig, result) {
      if (sig != null) executed.set(sig, result);
    },
  };
}
