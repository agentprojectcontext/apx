import { createOpenAiCompatibleEngine } from "./openai-compatible.js";

export default createOpenAiCompatibleEngine({
  id: "groq",
  defaultBaseUrl: "https://api.groq.com/openai/v1",
  apiKeyEnv: "GROQ_API_KEY",
  defaultFallbackModel: "groq:llama-3.3-70b-versatile",
});
