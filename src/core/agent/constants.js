export const MAX_TOOL_ITERS = 6;
export const ACK_ONLY_TOOLS = new Set(["send_telegram"]);
export const MAX_CONSECUTIVE_ACKS = 2;
// Tools whose semantics REQUIRE handing control back to the user. After the
// tool runs we break the loop — even under completionContract — because the
// task literally cannot advance without a human reply. Without this, models
// under forced toolChoice spam the same question across iterations.
export const TURN_ENDING_TOOLS = new Set(["ask_questions"]);
