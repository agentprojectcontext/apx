import { createOpenAiCompatibleEngine } from "./openai-compatible.js";

export default createOpenAiCompatibleEngine({
  id: "openai",
  defaultBaseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
});
