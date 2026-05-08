// Ollama adapter (https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion).
// Local-only. No API key. Default base_url http://localhost:11434.

function baseUrl(config) {
  return config.base_url || process.env.OLLAMA_HOST || "http://localhost:11434";
}

export default {
  id: "ollama",

  async chat({ system, messages, model, temperature = 0.7, maxTokens = 1024, tools, config = {} }) {
    if (!model) throw new Error("ollama: model required");

    // The caller can pass `messages` as either:
    //   [{role, content}]                       — usual shape
    //   [{role, content, tool_calls?}, {role: "tool", tool_call_id?, content}, ...]
    // We forward those fields straight through so the agent loop works.
    const fullMessages = [];
    if (system) fullMessages.push({ role: "system", content: system });
    for (const m of messages) {
      const out = { role: m.role };
      if (m.content !== undefined) {
        out.content =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      } else {
        out.content = "";
      }
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_name) out.tool_name = m.tool_name; // Ollama uses this field on role:"tool"
      fullMessages.push(out);
    }

    const body = {
      model,
      messages: fullMessages,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    };
    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = tools;
    }

    const url = `${baseUrl(config).replace(/\/$/, "")}/api/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ollama ${res.status}: ${text}`);
    }
    const json = await res.json();
    const message = json.message || {};
    return {
      text: message.content || "",
      tool_calls: message.tool_calls || null,
      message,
      usage: {
        input_tokens: json.prompt_eval_count || 0,
        output_tokens: json.eval_count || 0,
      },
      raw: json,
    };
  },
};
