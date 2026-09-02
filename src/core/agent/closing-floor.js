// The never-silent floor: what a surface says when a turn's closing came back
// empty.
//
// runAgent re-prompts a dud turn (MAX_EMPTY_RETRIES) and then gives up, and the
// comment where it gives up hands the problem on: "the surface's last-resort
// floor sends a non-silent reply". Telegram had one. The web did not —
// `result.text` went out verbatim, so an empty turn rendered as an empty bubble
// and was written to the thread as an empty assistant row, which is what the
// NEXT turn reads back as the answer it gave.
//
// Two layers, and the order is the whole point:
//
//   1. the model writes the closing itself, from what the turn actually did;
//   2. the canned i18n line goes out ONLY when the model cannot answer either —
//      usually the same outage that emptied the turn in the first place.
//
// Never silent beats never canned, in that order. A turn that DID answer never
// reaches the floor: it costs a model call, and it must never speak over a real
// reply.
import { authorLine } from "./author-line.js";
import { summarizeToolTrace, formatToolSummary } from "./tool-summary.js";
import { t, resolveLang } from "#core/i18n/index.js";

// Addressed to the model, not to the user: what the line has to DO. The words
// are the model's — see author-line.js.
const INSTRUCTION_WORKED =
  "You worked on the user's request but the closing message never got written. " +
  "Write it now: where the work got to, and whether you should keep going if something is left.";
const INSTRUCTION_NOTHING =
  "Your reply came back empty. Write the one line that should have gone out — " +
  "acknowledge them without claiming a result you do not have.";

/**
 * The line to send when there is no closing text. Callers decide WHEN they are
 * in that situation (the rules differ per surface — Telegram also treats a
 * closing that merely repeats the last streamed piece as nothing to send) and
 * what counts as having worked; this owns what gets said.
 *
 * @param {object}   o
 * @param {object}   o.globalConfig  config snapshot — names the model and the language
 * @param {string}  [o.model]        write with this model instead of the super-agent's
 *                                   (a project agent's line is its own to word)
 * @param {boolean} [o.worked]       did the turn do anything the user saw? Decides
 *                                   between "here's where it got to" and a bare ack
 * @param {string}  [o.lastText]     the last thing the turn actually said
 * @param {object}  [o.toolSummary]  summarizeToolTrace() output, for what it did
 * @param {Function}[o.authorLineFn] injectable for tests
 * @returns {Promise<{text: string, authored: boolean}>} `authored` is false when the
 *          canned floor spoke — worth logging, because it means two model calls
 *          in a row came back with nothing.
 */
export async function closingFloorLine({
  globalConfig,
  model = "",
  worked = false,
  lastText = "",
  toolSummary = null,
  authorLineFn = authorLine,
}) {
  const authored = await authorLineFn({
    globalConfig,
    ...(model ? { model } : {}),
    instruction: worked ? INSTRUCTION_WORKED : INSTRUCTION_NOTHING,
    context: [
      lastText ? `The last thing you said to them was: ${lastText}` : "",
      toolSummary ? `What you did this turn: ${formatToolSummary(toolSummary)}` : "",
    ].filter(Boolean).join("\n"),
  });
  const lang = resolveLang(globalConfig);
  return {
    text: authored || t(worked ? "reply.fallback_continue" : "reply.fallback_done", { lang }),
    authored: Boolean(authored),
  };
}

/**
 * The floor as a request/response surface needs it: hand it the turn's reply and
 * get back the text to send, persist and render.
 *
 * A non-empty reply comes back untouched and costs nothing — no model call, no
 * canned sentence written over an answer the model did give. Only an empty one
 * is floored, and `floored` says so for the log.
 *
 * NOT for an aborted turn. An interruption that wrote nothing is meant to leave
 * no bubble at all; flooring it would answer a question the user withdrew.
 *
 * @param {object}   o
 * @param {object}   o.globalConfig
 * @param {string}  [o.model]        the model to write with (a project agent's own)
 * @param {string}  [o.text]         the turn's reply, as it came back
 * @param {string}  [o.streamedText] the last text the turn streamed, if any
 * @param {object[]}[o.trace]        the turn's tool calls
 * @param {Function}[o.authorLineFn] injectable for tests
 * @returns {Promise<{text: string, authored: boolean, floored: boolean}>}
 */
export async function floorReplyText({
  globalConfig,
  model = "",
  text = "",
  streamedText = "",
  trace = [],
  authorLineFn = authorLine,
}) {
  if (String(text || "").trim()) return { text, authored: false, floored: false };
  const toolSummary = summarizeToolTrace(trace);
  const { text: line, authored } = await closingFloorLine({
    globalConfig,
    model,
    // On the web the mid-turn prose was already rendered, so "worked" is not a
    // guess: either the user watched text arrive or a tool ran.
    worked: Boolean(String(streamedText || "").trim()) || Boolean(toolSummary),
    lastText: String(streamedText || "").trim(),
    toolSummary,
    authorLineFn,
  });
  return { text: line, authored, floored: true };
}
