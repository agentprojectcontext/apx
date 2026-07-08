// Stuck detection (OpenHands StuckDetector pattern, adapted to the APX loop).
//
// Two loop shapes matter here — both invisible to the side-effect dedupe,
// which only guards mutating tools:
//   - action_observation: the model re-issues the SAME call and gets the SAME
//     result N times (read_file on the same path, list_* over and over);
//   - action_error: the SAME call keeps erroring M times in a row (auth wall,
//     missing binary) — different error text still counts, retrying is the
//     stuck part.
//
// The loop's monologue/no-tool patterns don't apply: run-agent already breaks
// when a turn produces no tool calls.

export function stuckDetectionConfig(globalConfig) {
  const raw = globalConfig?.super_agent?.stuck_detection || {};
  return {
    enabled: raw.enabled !== false,
    action_repeat:
      Number.isFinite(raw.action_repeat) && raw.action_repeat > 1 ? raw.action_repeat : 4,
    error_repeat:
      Number.isFinite(raw.error_repeat) && raw.error_repeat > 1 ? raw.error_repeat : 3,
  };
}

const WINDOW_SIZE = 20;

export function createStuckDetector(cfg) {
  const window = [];
  return {
    record({ tool, argsSig, resultSig, isError }) {
      window.push({ tool, argsSig, resultSig, isError: isError === true });
      if (window.length > WINDOW_SIZE) window.shift();
    },

    // Returns { pattern, tool, repeats } when a stuck pattern closes on the
    // latest record, else null. Checked after every tool execution.
    check() {
      if (!cfg.enabled) return null;

      const errs = window.slice(-cfg.error_repeat);
      if (
        errs.length === cfg.error_repeat &&
        errs.every(
          (r) => r.isError && r.tool === errs[0].tool && r.argsSig === errs[0].argsSig
        )
      ) {
        return { pattern: "action_error", tool: errs[0].tool, repeats: cfg.error_repeat };
      }

      const acts = window.slice(-cfg.action_repeat);
      if (
        acts.length === cfg.action_repeat &&
        acts.every(
          (r) =>
            r.tool === acts[0].tool &&
            r.argsSig === acts[0].argsSig &&
            r.resultSig === acts[0].resultSig
        )
      ) {
        return { pattern: "action_observation", tool: acts[0].tool, repeats: cfg.action_repeat };
      }

      return null;
    },

    // Cleared after a nudge so old records can't instantly re-trigger — only
    // NEW repetitions after the warning count towards the abort.
    reset() {
      window.length = 0;
    },
  };
}

// In-band note, WRAPUP_SIGNAL-style: shapes behavior only, wording stays the
// model's. Delivered as a conversation turn because weak models reliably
// answer the latest turn but routinely ignore system-suffix nudges.
export function stuckNudgeSignal({ tool, repeats, pattern }) {
  const shape =
    pattern === "action_error"
      ? `kept failing the same way ${repeats} times in a row`
      : `returned the same result ${repeats} times in a row`;
  return (
    `[Internal turn note — this is NOT from the user. Your call to \`${tool}\` ` +
    `${shape}. You appear to be stuck in a loop. Do NOT repeat that exact call ` +
    "again. Either take a genuinely different approach (different tool, " +
    "different arguments), or — if you cannot advance without help — tell the " +
    "user plainly, in their language, what you tried and what is blocking you.]"
  );
}
