// OpenAI Chat Completions adapter (https://platform.openai.com/docs/api-reference/chat).
// Direct fetch, no SDK.

const API_BASE = "https://api.openai.com/v1/chat/completions";

function getKey(config) {
  return config.api_key || process.env.OPENAI_API_KEY || "";
}

export default {
  id: "openai",

  async chat({ system, messages, model, temperature = 1.0, maxTokens = 1024, config = {} }) {
    const key = getKey(config);
    if (!key) throw new Error("openai: no api_key (set OPENAI_API_KEY or engines.openai.api_key)");
    if (!model) throw new Error("openai: model required");

    const fullMessages = [];
    if (system) fullMessages.push({ role: "system", content: system });
    for (const m of messages) {
      fullMessages.push({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    }

    const body = {
      model,
      messages: fullMessages,
      temperature,
      max_tokens: maxTokens,
    };

    const res = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `openai ${res.status}: ${json?.error?.message || JSON.stringify(json)}`
      );
    }
    const text = json.choices?.[0]?.message?.content || "";
    return {
      text,
      usage: {
        input_tokens: json.usage?.prompt_tokens || 0,
        output_tokens: json.usage?.completion_tokens || 0,
      },
      raw: json,
    };
  },
};
