// Per-turn tool-loop budget for conversational surfaces (telegram/desktop/voice
// /deck). The LAST of these iterations is reserved by run-agent.js for a
// tool-free, model-authored wrap-up — so a multi-step task gets ~N-1 action
// steps and always closes with a contextual message instead of going silent.
// Coding surfaces (web Code / terminal Build) raise this via maxIters and use
// the finish-tool completionContract instead.
export const MAX_TOOL_ITERS = 10;
export const ACK_ONLY_TOOLS = new Set(["send_telegram"]);
export const MAX_CONSECUTIVE_ACKS = 2;
// Tools whose semantics REQUIRE handing control back to the user. After the
// tool runs we break the loop — even under completionContract — because the
// task literally cannot advance without a human reply. Without this, models
// under forced toolChoice spam the same question across iterations.
export const TURN_ENDING_TOOLS = new Set(["ask_questions"]);
