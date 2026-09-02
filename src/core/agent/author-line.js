// One short line, written by the model instead of written for it.
//
// A few messages are the host's to TRIGGER but not to word: the ack after a
// /reset, the closing of a turn that came back empty. They lived in the i18n
// dicts as one canned string per case per language — copy that ages in place
// while the agent's voice moves on, and that has to be re-translated by hand
// every time a language is added. This asks the model for the line instead.
//
// Deliberately NOT a turn: no tools, no history, no persistence, no streaming.
// One directive in, one line out. It never throws and never blocks for long —
// an unusable engine, a timeout or an empty answer all come back as "", and the
// caller falls through to its own floor. That floor is the reason this can be
// best-effort: nothing here is allowed to be the difference between a reply and
// silence.
import { callEngine } from "../engines/index.js";
import { stripReasoning } from "../util/thinking.js";

/** How long the caller waits for a line it could also do without. */
export const AUTHOR_LINE_TIMEOUT_MS = 8000;

// The only fixed text left: an instruction to the model, not copy for the user.
// It says how to write, never what to say — the what is the caller's
// `instruction`, and the words are the model's.
const SYSTEM = [
  "You are the assistant, writing ONE short line to the user in a chat you are already in.",
  "Write it in the user's language and in your own voice — natural, specific, never a template.",
  "Plain text only: no markdown, no quotes around it, no preamble, no sign-off.",
  "Output the line and nothing else.",
].join("\n");

/**
 * The most specific language tag the config has. `user.locale` before
 * `user.language` on purpose: "es" comes back as neutral Spanish, "es-AR" comes
 * back in voseo — the difference between a line that sounds like the agent and
 * one that sounds like a translation of it.
 */
function languageTag(globalConfig, override) {
  return String(override || globalConfig?.user?.locale || globalConfig?.user?.language || "").trim();
}

/** Strip the wrapper a model puts around a line it was asked to produce. */
function cleanLine(raw) {
  let s = stripReasoning(String(raw || "")).answer.trim();
  if (!s) return "";
  // A fenced block around a one-liner is packaging, not content.
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  // Same for quotes the model wrapped the whole line in.
  if (s.length > 1 && /^["'“”«](.|\n)*["'“”»]$/.test(s)) s = s.slice(1, -1).trim();
  // It was asked for one line; blank lines mean it wrote a note instead.
  return s.replace(/\n{2,}/g, "\n").trim();
}

/**
 * Ask the super-agent's model for a single line.
 *
 * @param {object}  o
 * @param {object}  o.globalConfig  config snapshot (names the model + language)
 * @param {string}  o.instruction   what the line has to do, addressed to the model
 * @param {string} [o.model]        write with this model instead of the super-agent's.
 *                                  A project agent's line is its own to word — it is
 *                                  the one whose voice the thread is in.
 * @param {string} [o.context]      what just happened, so the line can be specific
 * @param {string} [o.lang]         override the tag to write in; defaults to the config's locale
 * @param {number} [o.maxTokens]
 * @param {number} [o.timeoutMs]
 * @param {AbortSignal} [o.signal]  caller's own abort (combined with the timeout)
 * @param {Function} [o.callEngineFn] injectable for tests
 * @returns {Promise<string>} the line, or "" when the caller should use its floor
 */
export async function authorLine({
  globalConfig,
  instruction,
  model = "",
  context = "",
  lang = "",
  maxTokens = 160,
  timeoutMs = AUTHOR_LINE_TIMEOUT_MS,
  signal = null,
  callEngineFn = callEngine,
}) {
  const modelId = model || globalConfig?.super_agent?.model || "";
  if (!modelId || !instruction) return "";

  const parts = [instruction];
  if (context) parts.push(context);
  // A language hint, not a phrasing one: /reset carries no user prose to mirror,
  // so without this the model answers a bare command in whatever it defaults to.
  const tag = languageTag(globalConfig, lang);
  if (tag) parts.push(`Write in this language (BCP-47 tag): ${tag}.`);

  // A line nobody is waiting on must not hold the turn open. The caller's own
  // abort still wins when it fires first.
  const timeout = AbortSignal.timeout(Math.max(1000, timeoutMs));
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const r = await callEngineFn({
      modelId,
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
      config: globalConfig,
      maxTokens,
      signal: combined,
    });
    return cleanLine(r?.text);
  } catch {
    // Engine down, model unknown, timed out, aborted: all the same answer.
    return "";
  }
}
