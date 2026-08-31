import { CHANNELS } from "#core/constants/channels.js";
// Per-turn tool-loop budget for conversational surfaces (telegram/desktop/voice
// /deck). The LAST of these iterations is reserved by run-agent.js for a
// tool-free, model-authored wrap-up — so a multi-step task gets ~N-1 action
// steps and always closes with a contextual message instead of going silent.
// Coding surfaces (web Code / terminal Build) raise this via maxIters and use
// the finish-tool completionContract instead.
export const MAX_TOOL_ITERS = 10;
// Telegram is the "do real work for me" conversational surface (the super-agent
// Roby): it needs to chain explore→edit→verify→close autonomously, not stop
// after ~9 actions and ask "want me to continue?". A budget of 10 left only one
// usable action step before the reserved wrap-up, so multi-step tasks routinely
// cut off mid-job. We give it a real autonomy budget (mirroring the TUI Code
// surface's maxIters:40) while keeping it below the coding surfaces. The
// reserved final-step wrap-up still applies, but now only fires when a task
// genuinely exhausts this budget — a rare safety floor, not the default close.
// Overridable per-deployment via config.super_agent.telegram_max_iters.
export const TELEGRAM_TOOL_ITERS = 24;
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
// The channels WEB_TOOL_ITERS applies to. Coding surfaces (web_code, code) are
// deliberately absent: they set their own budget alongside the completion
// contract, and that pairing is what makes them stop on `finish` rather than on
// a count.
const RUN_TO_COMPLETION_CHANNELS = new Set([CHANNELS.WEB, CHANNELS.WEB_SIDEBAR]);

/**
 * Default tool-loop budget for a super-agent turn on `channel`, or null when
 * the channel has no opinion and runAgent's own default should stand. An
 * explicit `maxIters` from the caller always wins over this.
 *
 * Telegram resolves its budget at its own call site (channels/telegram/reply.js)
 * and routines at theirs (routines/runner.js); this covers the surfaces that
 * reach runSuperAgent through the plain daemon chat route.
 */
export function superAgentToolIters(config, channel) {
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

