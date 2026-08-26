// Shared OpenAI-compatible chat adapter (OpenAI, Groq, OpenRouter, …).
import { pingUrl } from "./_health.js";
import { streamSseDataEvents } from "./_streaming.js";

// Adapters stash provider-private metadata on tool_calls under an underscore
// prefix (e.g. gemini's `_thoughtSignature`). Strict OpenAI-shaped APIs reject
// unknown properties, and a retry-chain switch can hand us a turn produced by
// another engine — so scrub those keys on the way out.
function stripPrivateFields(tc) {
  if (!tc || typeof tc !== "object") return tc;
  const out = {};
  for (const [k, v] of Object.entries(tc)) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

/** OpenAI multimodal content: text plus any `images` riding on the turn.
 *  Without this, run-agent's turnImages were silently dropped and a vision
 *  model (or a text model behind a vision bridge) never saw the photo. */
function contentForOpenAi(m) {
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
  const imgs = Array.isArray(m.images)
    ? m.images.filter((im) => im && im.data && im.mime)
    : [];
  if (!imgs.length) return text;
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...imgs.map((im) => ({
      type: "image_url",
      image_url: { url: `data:${im.mime};base64,${im.data}` },
    })),
  ];
}

export function createOpenAiCompatibleEngine({
  id,
  defaultBaseUrl,
  apiKeyEnv,
  defaultFallbackModel = null,
  extraHeaders = {},
  decorateMessage = null,
  // Zen free-tier accepts the literal key "public" with the opencode UA.
  // Without a key the adapter would refuse the call even though the gateway
  // is happy — so an engine can opt into a built-in default.
  defaultApiKey = "",
}) {
  function getKey(config) {
    return config?.api_key || process.env[apiKeyEnv] || defaultApiKey || "";
  }

  function getBaseUrl(config) {
    const raw = config?.base_url || defaultBaseUrl || "https://api.openai.com/v1";
    return String(raw).replace(/\/$/, "");
  }

  // Headers beyond the ones every call needs. Some gateways gate on something
  // other than the key — OpenCode Zen serves its free tier only to a caller
  // that identifies itself as the opencode client — and a self-hosted proxy in
  // front of a model may want its own. The adapter carries a default per
  // engine; `engines.<id>.headers` in config adds to or overrides it. The
  // per-call ones (auth, content-type) always win, so config can't blank out
  // the key by accident.
  function buildHeaders(config, perCall = {}) {
    const merged = { ...extraHeaders, ...(config?.headers || {}), ...perCall };
    const out = {};
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== "") out[String(k).toLowerCase()] = String(v);
    }
    return out;
  }

  return {
    id,
    needsApiKey: true,
    apiKeyEnv,
    defaultBaseUrl,
    defaultFallbackModel,
    buildHeaders,

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
        headers: buildHeaders(config, { authorization: `Bearer ${getKey(config)}` }),
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
      onToken,
      onReasoningToken,
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
      //   - images       (user/tool turns carrying vision bytes — rendered as
      //                   multimodal content parts; text-only models ignore or
      //                   400, which the vision bridge in run-agent covers)
      //
      // Dropping any of these is the cause of the
      //   "messages.N.tool_call_id: property 'tool_call_id' is missing"
      // 400 we saw on Groq when llama-3.3 emitted a pseudo-tool call.
      //
      // Rebuilding the entry from scratch (rather than spreading `m`) is what
      // keeps engine-private fields off the wire — strict OpenAI-shaped APIs
      // reject unknown properties. An engine that needs one of them replayed
      // for a specific model opts in through `decorateMessage`; see zen.js.
      const fullMessages = [];
      if (system) fullMessages.push({ role: "system", content: system });
      for (const m of messages) {
        const entry = {
          role: m.role,
          content: contentForOpenAi(m),
        };
        if (m.tool_calls)    entry.tool_calls   = m.tool_calls.map(stripPrivateFields);
        if (m.tool_call_id)  entry.tool_call_id = m.tool_call_id;
        // Some adapters expect `name` on tool messages; we map from tool_name
        // (what run-agent.js writes) to be safe.
        if (m.role === "tool" && (m.tool_name || m.name)) {
          entry.name = m.name || m.tool_name;
        }
        if (decorateMessage) decorateMessage(entry, m, { model, config });
        fullMessages.push(entry);
      }

      const body = {
        model,
        messages: fullMessages,
        temperature,
        max_tokens: maxTokens,
      };

      // Thinking, off at the source. A reasoning model spends the token budget
      // planning before it writes a word, so a small max_tokens comes back with
      // a full chain of thought and an EMPTY answer — and the operator pays for
      // both. `thinking: false` on the provider stops it being generated;
      // `reasoning_effort: "none"` is the knob the OpenAI-shaped gateways read
      // (verified against Zen: reasoning_tokens drops to 0). Only sent when the
      // operator asked for it — a provider that never heard of the field 400s.
      if (config?.thinking === false) body.reasoning_effort = "none";

      if (tools && tools.length > 0) {
        body.tools = tools;
        if (toolChoice === "required" || toolChoice === "any") {
          body.tool_choice = "required";
        } else if (toolChoice && typeof toolChoice === "object") {
          body.tool_choice = toolChoice;
        }
      }

      // Stream when the caller wants tokens as they land. A tool-forced turn is
      // excluded: it has no prose to stream, only a call to assemble.
      const wantsStream =
        typeof onToken === "function" && toolChoice !== "required" && toolChoice !== "any";
      if (wantsStream) {
        body.stream = true;
        // Streamed responses omit usage unless asked. Gateways that don't know
        // the field ignore it; Zen sends the totals in a final choice-less row.
        body.stream_options = { include_usage: true };
      }

      const res = await fetch(`${getBaseUrl(config)}/chat/completions`, {
        method: "POST",
        headers: buildHeaders(config, {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        }),
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        // An error answers as JSON even when the request asked for a stream.
        const err = await res.json().catch(() => null);
        throw new Error(
          `${id} ${res.status}: ${err?.error?.message || JSON.stringify(err)}`
        );
      }

      if (wantsStream) return readStream(res, onToken, onReasoningToken);

      const json = await res.json();
      const choice = json.choices?.[0];
      const toolCalls = choice?.message?.tool_calls;

      return {
        // Reasoning travels in its own field, never folded into the answer.
        // It used to be wrapped in <think>…</think> and left inside `text` for
        // each surface to strip; the surfaces that forgot (web, CLI) showed the
        // model's notes to the user. Keeping the two apart at the boundary
        // means no surface can leak what it never received.
        text: choice?.message?.content || "",
        reasoning: choice?.message?.reasoning || choice?.message?.reasoning_content || "",
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

/**
 * Read an OpenAI-shaped SSE stream into the same result object the blocking
 * path returns. The two channels stay apart the whole way down: `content`
 * deltas reach `onToken`, reasoning reaches `onReasoningToken`, and a caller
 * that only passes the first never sees a word of the thinking. tool_calls are
 * reassembled by index (a call arrives split across rows: the name in one, the
 * arguments a character at a time after it).
 */
async function readStream(res, onToken, onReasoningToken) {
  let text = "";
  let reasoning = "";
  let finishReason;
  let usage = null;
  const calls = [];

  for await (const evt of streamSseDataEvents(res)) {
    if (evt.usage) usage = evt.usage;
    const choice = evt.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};

    if (delta.content) {
      text += delta.content;
      onToken(delta.content);
    }
    const think = delta.reasoning_content || delta.reasoning;
    if (think) {
      reasoning += think;
      if (typeof onReasoningToken === "function") onReasoningToken(think);
    }

    for (const tc of delta.tool_calls || []) {
      const i = Number.isFinite(tc.index) ? tc.index : calls.length;
      if (!calls[i]) calls[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
      const slot = calls[i];
      if (tc.id) slot.id = tc.id;
      if (tc.type) slot.type = tc.type;
      if (tc.function?.name) slot.function.name += tc.function.name;
      if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls = calls.filter((c) => c?.function?.name);
  return {
    text,
    reasoning,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    finish_reason: finishReason,
    usage: {
      input_tokens: usage?.prompt_tokens || 0,
      output_tokens: usage?.completion_tokens || 0,
    },
    raw: null,
  };
}
