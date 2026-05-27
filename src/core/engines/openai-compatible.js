// Shared OpenAI-compatible chat adapter (OpenAI, Groq, OpenRouter, …).

export function createOpenAiCompatibleEngine({ id, defaultBaseUrl, apiKeyEnv }) {
  function getKey(config) {
    return config?.api_key || process.env[apiKeyEnv] || "";
  }

  function getBaseUrl(config) {
    const raw = config?.base_url || defaultBaseUrl || "https://api.openai.com/v1";
    return String(raw).replace(/\/$/, "");
  }

  return {
    id,

    async chat({
      system,
      messages,
      model,
      temperature = 1.0,
      maxTokens = 1024,
      config = {},
      tools,
      toolChoice,
      signal,
    }) {
      const key = getKey(config);
      if (!key) {
        throw new Error(`${id}: no api_key (set ${apiKeyEnv} or engines.${id}.api_key)`);
      }
      if (!model) throw new Error(`${id}: model required`);

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

      if (tools && tools.length > 0) {
        body.tools = tools;
        if (toolChoice === "required" || toolChoice === "any") {
          body.tool_choice = "required";
        } else if (toolChoice && typeof toolChoice === "object") {
          body.tool_choice = toolChoice;
        }
      }

      const res = await fetch(`${getBaseUrl(config)}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          `${id} ${res.status}: ${json?.error?.message || JSON.stringify(json)}`
        );
      }

      const choice = json.choices?.[0];
      const text = choice?.message?.content || "";
      const toolCalls = choice?.message?.tool_calls;

      return {
        text,
        tool_calls: toolCalls?.length > 0 ? toolCalls : undefined,
        finish_reason: choice?.finish_reason,
        usage: {
          input_tokens: json.usage?.prompt_tokens || 0,
          output_tokens: json.usage?.completion_tokens || 0,
        },
        raw: json,
      };
    },
  };
}
