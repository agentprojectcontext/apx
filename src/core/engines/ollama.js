// Ollama adapter (https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion).
// Local-only. No API key. Default base_url http://localhost:11434.
import { pingUrl, fetchJsonWithTimeout, modelInOllamaTags } from "./_health.js";
import { streamJsonLines } from "./_streaming.js";

function baseUrl(config) {
  return config.base_url || process.env.OLLAMA_HOST || "http://localhost:11434";
}

// A negative keep_alive asks Ollama to retain the loaded model indefinitely.
// This is sent per request, so it takes precedence over the server default.
const KEEP_ALIVE_FOREVER = -1;

/**
 * Tool calls, in the shape Ollama actually accepts.
 *
 * Ollama wants `function.arguments` as an OBJECT. OpenAI wants a JSON STRING,
 * and APX carries whatever the engine that produced the call handed back — so a
 * string reaches here two ways, both ordinary: a turn that fell back from
 * another engine mid-loop (zen → ollama), and `extractBareFunctionCalls`, whose
 * recovered calls are stringified on purpose (tool-call-parser.js).
 *
 * Ollama does not reject a string outright. It tries to parse it with a lenient
 * scanner, which walks the text looking for a closing brace — so `{"command":
 * "ls"}` survives and a command containing its own JSON does not:
 *
 *   ollama 400: {"error":"Value looks like object, but can't find closing '}' symbol"}
 *
 * Seen 2026-09-14: an agent left two renders running whose commands echoed
 * segment JSON into a file. Both jobs finished, both wake-ups started a turn,
 * and both turns died on the SECOND iteration — the one that replays the call
 * — so the agent was woken twice and answered nothing either time. The failure
 * needs a big argument to show itself, which is why every smaller tool call in
 * the same chat worked all day.
 *
 * An unparseable string becomes `{}`, which is what the agent loop itself does
 * with one (run-agent.js). Losing the arguments of a call that already ran is a
 * worse record than sending them; losing the whole TURN is worse than both.
 */
function ollamaToolCalls(calls) {
  if (!Array.isArray(calls)) return calls;
  return calls.map((call) => {
    const fn = call?.function;
    if (!fn || typeof fn.arguments !== "string") return call;
    let args;
    try {
      args = JSON.parse(fn.arguments);
    } catch {
      args = {};
    }
    return { ...call, function: { ...fn, arguments: args && typeof args === "object" ? args : {} } };
  });
}

export default {
  id: "ollama",
  needsApiKey: false,
  defaultBaseUrl: "http://localhost:11434",

  /**
   * Health check. Two modes:
   *  - Loose (no candidateModel): just confirm `/api/tags` answers — useful
   *    for "is the host reachable" diagnostics in `apx status`.
   *  - Strict (candidateModel given): confirm the model is actually pulled
   *    on this host. Otherwise the chat call would fail with a confusing
   *    "model not found" mid-conversation; better to fall through to the
   *    next fallback now.
   */
  async health(config = {}, { timeoutMs = 800, candidateModel = null } = {}) {
    const base = baseUrl(config).replace(/\/$/, "");
    if (!candidateModel) {
      const res = await pingUrl(`${base}/api/tags`, { timeoutMs });
      return res.ok
        ? { ok: true, provider: "ollama", detail: base }
        : { ok: false, provider: "ollama", reason: res.reason || `HTTP ${res.status}`, detail: base };
    }
    const res = await fetchJsonWithTimeout(`${base}/api/tags`, { timeoutMs });
    if (!res.ok) {
      return { ok: false, provider: "ollama", reason: res.reason || `HTTP ${res.status}`, detail: base };
    }
    const { present, available } = modelInOllamaTags(res.json, candidateModel);
    if (present) return { ok: true, provider: "ollama", detail: base };
    return {
      ok: false,
      provider: "ollama",
      reason: `model "${candidateModel}" not loaded on this host`,
      detail: base,
      available,
    };
  },

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
      if (m.tool_calls) out.tool_calls = ollamaToolCalls(m.tool_calls);
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
        keep_alive: KEEP_ALIVE_FOREVER,
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
      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let doneReason = null;
      for await (const evt of streamJsonLines(res)) {
        const t = evt.message?.content || "";
        if (t) { text += t; onToken(t); }
        if (evt.done) {
          inputTokens = evt.prompt_eval_count || 0;
          outputTokens = evt.eval_count || 0;
          doneReason = evt.done_reason || null;
        }
      }
      return {
        text,
        tool_calls: null,
        message: { role: "assistant", content: text },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        finish_reason: doneReason,
        raw: null,
      };
    }

    // Non-streaming path (original)
    const body = {
      model,
      messages: fullMessages,
      stream: false,
      keep_alive: KEEP_ALIVE_FOREVER,
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
      // Ollama's word for "why did generation stop" is `done_reason`, and it
      // says "length" for exactly the case the agent loop needs to recover
      // from: the reply hit `num_predict` mid-sentence. Dropping it made
      // run-agent.js's wasTruncated() blind on this provider, so a cut-off
      // turn was silently accepted as the final answer instead of continuing.
      finish_reason: json.done_reason || null,
      raw: json,
    };
  },
};
