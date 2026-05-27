// Anthropic Messages API adapter (https://docs.anthropic.com/en/api/messages).
// No SDK dependency — direct fetch, keeps the daemon lean.

const API_BASE = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

function getKey(config) {
  return config.api_key || process.env.ANTHROPIC_API_KEY || "";
}

export default {
  id: "anthropic",
  needsApiKey: true,
  apiKeyEnv: "ANTHROPIC_API_KEY",
  defaultFallbackModel: "anthropic:claude-haiku-4-5",

  /**
   * Anthropic doesn't expose a cheap "/health" surface and `/v1/messages` is
   * billed. We treat "have an api_key" as the gate; the actual call surfaces
   * 401s if the key is bad. Marked `soft: true` so callers know this is a
   * presence check, not a real probe.
   */
  async health(config = {}) {
    const key = getKey(config);
    return key
      ? { ok: true, provider: "anthropic", soft: true }
      : { ok: false, provider: "anthropic", reason: "no api_key" };
  },

  async chat({ system, messages, model, temperature = 1.0, maxTokens = 1024, config = {}, tools, toolChoice, signal, onToken }) {
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

    // Streaming path — only when onToken provided AND no tool_choice=required
    // (we can't stream tool-forced turns because tool_calls are embedded in SSE)
    if (typeof onToken === "function" && toolChoice !== "required" && toolChoice !== "any") {
      body.stream = true;
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`anthropic ${res.status}: ${err.slice(0, 200)}`);
      }

      const decoder = new TextDecoder();
      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason = null;
      let buf = "";

      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          let evt;
          try { evt = JSON.parse(raw); } catch { continue; }
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            const t = evt.delta.text || "";
            if (t) { text += t; onToken(t); }
          } else if (evt.type === "message_delta") {
            stopReason = evt.delta?.stop_reason || stopReason;
            outputTokens = evt.usage?.output_tokens || outputTokens;
          } else if (evt.type === "message_start") {
            inputTokens = evt.message?.usage?.input_tokens || 0;
            outputTokens = evt.message?.usage?.output_tokens || 0;
          }
        }
      }

      return {
        text,
        tool_uses: undefined,
        stop_reason: stopReason,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        raw: null,
      };
    }

    // Non-streaming path (original)
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
      signal,
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
