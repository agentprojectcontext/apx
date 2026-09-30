import { createOpenAiCompatibleEngine } from "./openai-compatible.js";

// OpenAI's reasoning models (o-series, gpt-5 and later) reject `max_tokens` and
// any non-default `temperature` on Chat Completions: the call 400s before the
// model runs. The cap is spelled `max_completion_tokens` there.
export function isOpenAiReasoningModel(model) {
  return /^(o\d|gpt-([5-9]|\d{2,}))/i.test(String(model || ""));
}

export default createOpenAiCompatibleEngine({
  id: "openai",
  defaultBaseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  defaultFallbackModel: "openai:gpt-4o-mini",
  decorateBody(body, { model }) {
    if (!isOpenAiReasoningModel(model)) return;
    if (body.max_tokens != null) body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    delete body.temperature;
  },
});
