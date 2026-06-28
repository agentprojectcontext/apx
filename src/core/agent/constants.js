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
export const ACK_ONLY_TOOLS = new Set(["send_telegram"]);
export const MAX_CONSECUTIVE_ACKS = 2;
// Tools whose semantics REQUIRE handing control back to the user. After the
// tool runs we break the loop — even under completionContract — because the
// task literally cannot advance without a human reply. Without this, models
// under forced toolChoice spam the same question across iterations.
export const TURN_ENDING_TOOLS = new Set(["ask_questions"]);
