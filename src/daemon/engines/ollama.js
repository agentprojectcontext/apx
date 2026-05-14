// Ollama adapter (https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion).
// Local-only. No API key. Default base_url http://localhost:11434.

function baseUrl(config) {
  return config.base_url || process.env.OLLAMA_HOST || "http://localhost:11434";
}

export default {
  id: "ollama",

  async chat({ system, messages, model, temperature = 0.7, maxTokens = 1024, tools, toolChoice, config = {}, signal, onToken }) {
    if (!model) throw new Error("ollama: model required");

    // Ollama's /api/chat does not honor a tool_choice field. When the caller
    // wants to force a tool call ("required" / "any") we inject a strong
    // system-message hint instead so the model is much less likely to emit a
    // text-only acknowledgement like "ok dame un minuto" without calling a tool.
    const forceTool =
      Array.isArray(tools) && tools.length > 0 &&
      (toolChoice === "required" || toolChoice === "any");

    let effectiveSystem = system;
    if (forceTool) {
      const hint =
        "You MUST call one of the available tools to satisfy this turn. " +
        "Do NOT reply with text-only acknowledgements (no 'ok', 'sure', 'on it', 'dame un minuto'). " +
        "If you cannot decide which tool, pick the closest match and call it.";
      effectiveSystem = system ? `${system}\n\n${hint}` : hint;
    }

    // The caller can pass `messages` as either:
    //   [{role, content}]                       — usual shape
    //   [{role, content, tool_calls?}, {role: "tool", tool_call_id?, content}, ...]
    // We forward those fields straight through so the agent loop works.
    const fullMessages = [];
    if (effectiveSystem) fullMessages.push({ role: "system", content: effectiveSystem });
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

    const url = `${baseUrl(config).replace(/\/$/, "")}/api/chat`;

    // Streaming path — only when onToken provided AND no tools (Ollama streaming + tools is unreliable)
    if (typeof onToken === "function" && (!tools || tools.length === 0)) {
      const body = {
        model,
        messages: fullMessages,
        stream: true,
        options: { temperature, num_predict: maxTokens },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`ollama ${res.status}: ${t}`);
      }
      const decoder = new TextDecoder();
      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let buf = "";
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          const t = evt.message?.content || "";
          if (t) { text += t; onToken(t); }
          if (evt.done) {
            inputTokens = evt.prompt_eval_count || 0;
            outputTokens = evt.eval_count || 0;
          }
        }
      }
      return {
        text,
        tool_calls: null,
        message: { role: "assistant", content: text },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        raw: null,
      };
    }

    // Non-streaming path (original)
    const body = {
      model,
      messages: fullMessages,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    };
    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = tools;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
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
