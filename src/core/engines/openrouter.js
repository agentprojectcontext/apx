import { createOpenAiCompatibleEngine } from "./openai-compatible.js";

export default createOpenAiCompatibleEngine({
  id: "openrouter",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
});
