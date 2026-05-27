// Shared OpenAI-compatible chat adapter (OpenAI, Groq, OpenRouter, …).
import { pingUrl } from "./_health.js";

export function createOpenAiCompatibleEngine({
  id,
  defaultBaseUrl,
  apiKeyEnv,
  defaultFallbackModel = null,
}) {
  function getKey(config) {
    return config?.api_key || process.env[apiKeyEnv] || "";
  }

  function getBaseUrl(config) {
    const raw = config?.base_url || defaultBaseUrl || "https://api.openai.com/v1";
    return String(raw).replace(/\/$/, "");
  }

  return {
    id,
    needsApiKey: true,
    apiKeyEnv,
    defaultBaseUrl,
    defaultFallbackModel,

    /**
     * Health: confirm we have a key and the `/models` catalog answers.
     * Returns `soft: true` when /models fails — some keys are limited to
     * /chat/completions only, so we allow the chain to proceed but flag it.
     */
    async health(config = {}, { timeoutMs = 800 } = {}) {
      if (!getKey(config)) {
        return { ok: false, provider: id, reason: "no api_key" };
      }
      const base = getBaseUrl(config);
      const res = await pingUrl(`${base}/models`, {
        timeoutMs: Math.max(timeoutMs, 1200),
        headers: { authorization: `Bearer ${getKey(config)}` },
      });
      if (res.ok) return { ok: true, provider: id, detail: base };
      // Key present but catalog ping failed — keep going, the chat call will
      // either succeed or surface its own error. See backlog 13 (lazy retry).
      return {
        ok: true,
        provider: id,
        detail: base,
        soft: true,
        reason: res.reason || `HTTP ${res.status}`,
      };
    },

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

      // Serialise messages for the OpenAI Chat Completions wire format.
      //
      // We preserve four optional fields the loop relies on:
      //   - tool_calls  (assistant turns that emit a structured call)
      //   - tool_call_id (tool result turns — Groq / OpenAI strict require
      //                   this to match the assistant's tool_call id)
      //   - name         (some providers prefer it on tool messages)
      //
      // Dropping any of these is the cause of the
      //   "messages.N.tool_call_id: property 'tool_call_id' is missing"
      // 400 we saw on Groq when llama-3.3 emitted a pseudo-tool call.
      const fullMessages = [];
      if (system) fullMessages.push({ role: "system", content: system });
      for (const m of messages) {
        const entry = {
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        };
        if (m.tool_calls)    entry.tool_calls   = m.tool_calls;
        if (m.tool_call_id)  entry.tool_call_id = m.tool_call_id;
        // Some adapters expect `name` on tool messages; we map from tool_name
        // (what run-agent.js writes) to be safe.
        if (m.role === "tool" && (m.tool_name || m.name)) {
          entry.name = m.name || m.tool_name;
        }
        fullMessages.push(entry);
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
