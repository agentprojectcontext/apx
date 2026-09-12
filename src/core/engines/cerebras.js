// Cerebras — OpenAI-compatible inference on their own wafer-scale hardware.
//
// Here for one reason: latency. Cerebras serves open models at a throughput no
// GPU gateway matches, which is what makes it the answer to "the model is fast
// enough but the wait is killing the loop" — an agent that runs all day feels a
// slow first token on every single turn.
//
// NOT free: the account needs a payment method on file before the API answers
// at all — even the $5 of starter credit is gated behind adding a card, and
// without one every model replies 402 payment_required. Kept for installs that
// do pay; for a zero-cost fast engine reach for groq instead.
import { createOpenAiCompatibleEngine } from "./openai-compatible.js";

export default createOpenAiCompatibleEngine({
  id: "cerebras",
  defaultBaseUrl: "https://api.cerebras.ai/v1",
  apiKeyEnv: "CEREBRAS_API_KEY",
  defaultFallbackModel: "cerebras:qwen-3.8-27b",
});
