// Anthropic Messages API adapter (https://docs.anthropic.com/en/api/messages).
// No SDK dependency — direct fetch, keeps the daemon lean.

const API_BASE = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

function getKey(config) {
  return config.api_key || process.env.ANTHROPIC_API_KEY || "";
}

export default {
  id: "anthropic",

  async chat({ system, messages, model, temperature = 1.0, maxTokens = 1024, config = {}, tools, toolChoice }) {
    const key = getKey(config);
    if (!key) throw new Error("anthropic: no api_key (set ANTHROPIC_API_KEY or engines.anthropic.api_key)");
    if (!model) throw new Error("anthropic: model required");

    const body = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    };
    if (system) body.system = system;

    // Tool use support — pass tools array and optional tool_choice.
    // toolChoice="required" → { type: "any" } forces at least one tool call per turn,
    // preventing the model from giving an empty acknowledgment instead of acting.
    if (tools && tools.length > 0) {
      body.tools = tools;
      if (toolChoice === "required" || toolChoice === "any") {
        body.tool_choice = { type: "any" };
      } else if (toolChoice && typeof toolChoice === "object") {
        body.tool_choice = toolChoice;
      }
    }

    const res = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `anthropic ${res.status}: ${json?.error?.message || JSON.stringify(json)}`
      );
    }

    // Extract text blocks; also capture tool_use blocks for callers that need them
    const text = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolUses = (json.content || []).filter((b) => b.type === "tool_use");

    return {
      text,
      tool_uses: toolUses.length > 0 ? toolUses : undefined,
      stop_reason: json.stop_reason,
      usage: {
        input_tokens: json.usage?.input_tokens || 0,
        output_tokens: json.usage?.output_tokens || 0,
      },
      raw: json,
    };
  },
};
