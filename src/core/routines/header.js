// The automation header prepended to every routine's LLM prompt at run time.
//
// It is the native replacement for the old `echo "…date…"` pre_command +
// `{{pre_output}}` trick: the runner (core/routines/runner.js) builds this block
// once per run and puts it at the very top of the LLM prompt (spec.prompt), so
// the model always opens on who it is, where its memory lives, and what "now"
// is — without any per-routine shell plumbing. It is NOT prepended to a telegram
// routine's spec.text: that string is the message body sent verbatim to the
// chat, so a header there would leak into the delivered message.
//
// The clock is reported two ways on purpose: machine-friendly (ISO + epoch ms,
// UTC) so a routine can diff runs deterministically, and human-friendly in the
// owner's configured timezone (config.user.timezone / .locale) so a reply reads
// in local wall-clock time.
import { isoToMs } from "#core/util/time.js";
import { routineMemoryPath } from "#core/stores/routine-memory.js";

/** "2026-08-20T13:00:35.123Z (1787230835123)" — ISO with millis + epoch ms. */
function machineStamp(ms) {
  return `${new Date(ms).toISOString()} (${ms})`;
}

/**
 * Wall-clock stamp in the owner's zone, e.g.
 * "miércoles, 20 de agosto de 2026, 10:00:35 (America/Argentina/Buenos_Aires)".
 * Returns "" when no timezone is configured or the zone is unusable, so the
 * caller simply omits the local line rather than printing a broken one.
 */
function localStamp(ms, timezone, locale) {
  if (!timezone) return "";
  try {
    const s = new Intl.DateTimeFormat(locale || "en", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "medium",
    }).format(new Date(ms));
    return `${s} (${timezone})`;
  } catch {
    return "";
  }
}

/**
 * Build the automation header block for one routine run.
 *
 * @param {object} routine  The routine record (name, id, last_run_at).
 * @param {object} opts
 *   - storagePath: project storage root, to resolve the memory.md path
 *   - config:      resolved config (reads config.user.timezone / .locale)
 *   - nowMs:       run-start epoch ms (injected so a run stamps one instant)
 * @returns {string} The header text (no trailing newline).
 */
export function buildRoutineHeader(routine, { storagePath, config, nowMs } = {}) {
  const user = config?.user || {};
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const lastMs = isoToMs(routine?.last_run_at);
  const memPath = routine?.id && storagePath
    ? routineMemoryPath(storagePath, routine.id)
    : "";
  const local = localStamp(now, user.timezone, user.locale || user.language);

  const lines = [
    `Automation: ${routine?.name || "—"}`,
    `Automation ID: ${routine?.id || "—"}`,
  ];
  if (memPath) lines.push(`Automation memory: ${memPath}`);
  lines.push(`Last run: ${lastMs ? machineStamp(lastMs) : "never"}`);
  lines.push(`This run: ${machineStamp(now)}${local ? ` — ${local}` : ""}`);
  return lines.join("\n");
}

/**
 * Prepend the header to a prompt body, separated by a blank line. A non-string
 * body (a spec that has no prompt/text) passes through untouched.
 */
export function prependRoutineHeader(prompt, header) {
  if (typeof prompt !== "string" || !header) return prompt;
  return `${header}\n\n${prompt}`;
}
