import { CHANNELS } from "#core/constants/channels.js";
// Per-turn tool-loop budget for conversational surfaces (telegram/desktop/voice
// /deck). The LAST of these iterations is reserved by run-agent.js for a
// tool-free, model-authored wrap-up — so a multi-step task gets ~N-1 action
// steps and always closes with a contextual message instead of going silent.
// Coding surfaces (web Code / terminal Build) raise this via maxIters and use
// the finish-tool completionContract instead.
export const MAX_TOOL_ITERS = 10;
// Telegram is an owner-controlled work surface too. Its live action notices
// make long turns observable, so stopping after a small count and asking
// "should I continue?" is friction rather than a guardrail. This is a runaway
// backstop: the loop normally ends when work is done, while stuck detection
// still aborts repeats. Overridable via config.super_agent.telegram_max_iters.
export const TELEGRAM_TOOL_ITERS = 1000;
// A background routine that does NOT report to Telegram has no human waiting on
// a bounded chat turn: nobody is going to read a "want me to keep going?"
// wrap-up, let alone answer it. Capping such a run at the conversational budget
// just filed a half-finished record — Magui hitting ~23 steps and stopping
// mid-backlog. So a non-Telegram routine runs until the work is actually done:
// the loop already ends on its own the moment the model stops calling tools
// (run-agent.js), and this high finite ceiling stays only as a runaway backstop.
// Overridable per-deployment via config.super_agent.routine_max_iters.
export const ROUTINE_UNCAPPED_TOOL_ITERS = 1000;
// The web chat — big chat and docked sidebar — is the surface you WATCH: every
// tool call renders live, streaming survives a refresh, and a person is one
// click from stopping the turn. The bounded budget exists for the surface where
// none of that is true. On Telegram a turn scrolls past on a phone with no way
// to see it going wrong, so stopping to ask IS the guardrail. On web the human
// is the guardrail, and being asked "want me to keep going?" every 9 actions is
// pure friction — the whole point of the surface is that it finishes the job.
//
// So web runs like a non-Telegram routine: until the work is actually done. The
// loop already ends on its own the moment the model stops calling tools, stuck
// detection aborts the repeat-loops, and this ceiling is only the runaway
// backstop — not a normal stopping point.
// Overridable per-deployment via config.super_agent.web_max_iters.
export const WEB_TOOL_ITERS = ROUTINE_UNCAPPED_TOOL_ITERS;
// ONE TURN, ONE BUDGET. Every number above is the budget for a TURN, not for
// one pass of the tool loop — and a turn can run the loop more than once, when
// the completion judge sends it back to finish something (agent/judge.js). Those
// rounds SHARE the number: each gets what the rounds before it left. Before
// this, every round was handed the full budget again and nothing summed, so the
// real ceiling was (1 + judge.max_iterations) × the number written here — 3×1000
// on web from a single message. That ceiling was never a decision anyone made;
// it was the product of two settings that didn't know about each other.
//
// The alternative was a separate, smaller budget for verification rounds. It was
// rejected for the reason this comment exists: a second number does not tell you
// what one turn may spend, it just makes you multiply two numbers instead of
// one. The budget answers "how many tool steps before we stop and ask the
// human", and that question is about the turn.
//
// The floor below is what a round needs to be worth running: one action step,
// plus the tool-free closing step run-agent.js reserves. With less than that a
// round can only produce a "ran out of room" recap — over the top of an answer
// we already have — so the judge loop stops instead of starting one.
export const MIN_JUDGE_ROUND_ITERS = 2;
// The channels WEB_TOOL_ITERS applies to. Coding surfaces (web_code, code) are
// deliberately absent: they set their own budget alongside the completion
// contract, and that pairing is what makes them stop on `finish` rather than on
// a count.
const RUN_TO_COMPLETION_CHANNELS = new Set([CHANNELS.WEB, CHANNELS.WEB_SIDEBAR]);

/**
 * Default tool-loop budget for a turn on `channel`, or null when the channel
 * has no opinion and runAgent's own default should stand. An explicit
 * `maxIters` from the caller always wins over this.
 *
 * Keyed on the SURFACE, not on who is answering: the budget is about whether a
 * human can watch the turn work, which is just as true of a project agent as it
 * is of the super-agent. Both reach it — runSuperAgent for Roby, runAgentTurn
 * for everyone else — because a chat that stops every 9 actions to ask is the
 * same friction whichever agent is in it.
 *
 * Telegram resolves its budget at its own call site (channels/telegram/reply.js)
 * and routines at theirs (routines/runner.js); this covers the surfaces that
 * reach the loop through the plain daemon chat routes.
 */
export function channelToolIters(config, channel) {
  if (!RUN_TO_COMPLETION_CHANNELS.has(channel)) return null;
  const raw = Number(config?.super_agent?.web_max_iters);
  return Number.isFinite(raw) && raw > 0 ? raw : WEB_TOOL_ITERS;
}
// Defined in tools/names.js, next to the names they reference.
export { ACK_ONLY_TOOLS, TURN_ENDING_TOOLS } from "./tools/names.js";
export const MAX_CONSECUTIVE_ACKS = 2;
// Tools whose semantics REQUIRE handing control back to the user. After the
// tool runs we break the loop — even under completionContract — because the
// task literally cannot advance without a human reply. Without this, models
// under forced toolChoice spam the same question across iterations.
