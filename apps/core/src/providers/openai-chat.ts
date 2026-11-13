import { grammarSchema } from "./tool-schema.ts";
// OpenAI-compatible chat completions: OpenAI, Gemini (OpenAI endpoint), OpenRouter, Groq, Ollama, LM Studio…
import {
  type AssistantItem,
  type Completion,
  type Finish,
  ProviderError,
  post,
  sseData,
  type ToolCall,
  type Transport,
  type TransportRequest,
  type Usage,
} from "./types.ts";

type Delta = {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};
type Chunk = {
  choices?: Array<{ delta?: Delta; message?: AssistantItem; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
};

const finishOf = (reason: string | null | undefined): Finish =>
  reason === "stop" ? "stop" : reason === "tool_calls" ? "tool_calls" : reason === "length" ? "length" : "other";

const usageOf = (u: Chunk["usage"]): Usage | undefined => {
  if (!u) return undefined;
  const cached = u.prompt_tokens_details?.cached_tokens;
  return { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, ...(cached ? { cached } : {}) };
};

/**
 * Gemini refuses a tool call in the history without the thought signature it gave it; a call another model made has
 * none, so it carries the placeholder Gemini documents for calls it did not make.
 */
const FOREIGN_SIGNATURE = { google: { thought_signature: "skip_thought_signature_validator" } };

function signed(m: AssistantItem): AssistantItem {
  if (!m.tool_calls?.some((c) => !c.extra_content)) return m;
  return {
    ...m,
    tool_calls: m.tool_calls.map((c) => (c.extra_content ? c : { ...c, extra_content: FOREIGN_SIGNATURE })),
  };
}

const isGemini = (baseUrl: string) => /generativelanguage\.googleapis\.com/.test(baseUrl);

/** User items with images become content parts (text, then each image as a data URL); the rest go as they are. */
function wire(items: TransportRequest["messages"], gemini: boolean): unknown[] {
  return items.map((m) => {
    if (gemini && m.role === "assistant") return signed(m);
    if (m.role !== "user" || !m.images?.some((i) => i.data)) {
      if (m.role !== "user" || !m.images) return m;
      const { images: _i, ...rest } = m;
      return rest;
    }
    return {
      role: "user",
      content: [
        { type: "text", text: m.content },
        ...m.images.flatMap((i) =>
          i.data ? [{ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }] : [],
        ),
      ],
    };
  });
}

export const openaiChat: Transport = async (req) => {
  const stream = Boolean(req.onText);
  const { res, touch, done } = await post(
    req,
    `${req.baseUrl.replace(/\/$/, "")}/chat/completions`,
    { authorization: `Bearer ${req.key}` },
    {
      model: req.model,
      ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
      messages: wire(req.messages, isGemini(req.baseUrl)),
      ...(req.tools.length
        ? {
            tools: req.tools.map((tool) => ({
              ...tool,
              function: { ...tool.function, parameters: grammarSchema(tool.function.parameters) },
            })),
            tool_choice: "auto",
          }
        : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    },
  );
  try {
    if (!stream) {
      const body = (await res.json()) as Chunk;
      const choice = body.choices?.[0];
      if (!choice?.message) throw new ProviderError("empty", "empty response");
      const usage = usageOf(body.usage);
      return {
        message: { ...choice.message, role: "assistant" },
        model: req.model,
        finish: finishOf(choice.finish_reason),
        ...(usage ? { usage } : {}),
      };
    }
    let text = "";
    let thinking = "";
    let finish: Finish = "other";
    let usage: Usage | undefined;
    const calls: ToolCall[] = [];
    const extra: Record<string, unknown> = {};
    for await (const data of sseData(res, touch)) {
      if (data === "[DONE]") continue;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data) as Chunk;
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError("overloaded", `stream error: ${chunk.error.message ?? "unknown"}`);
      usage = usageOf(chunk.usage) ?? usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finish = finishOf(choice.finish_reason);
      const delta = choice?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        req.onText?.(text);
      }
      // Models that think aloud send it beside the answer (DeepSeek, OpenRouter, Ollama): shown live, not kept here.
      const thought =
        (delta as { reasoning_content?: unknown; reasoning?: unknown }).reasoning_content ??
        (delta as { reasoning?: unknown }).reasoning;
      if (typeof thought === "string" && thought) {
        thinking += thought;
        req.onThinking?.(thinking);
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? calls.length;
        const { index: _i, function: fn, ...rest } = tc;
        const cur = calls[i] ?? ({ id: "", type: "function", function: { name: "", arguments: "" } } as ToolCall);
        Object.assign(cur, rest);
        if (fn?.name) cur.function.name = cur.function.name || fn.name;
        if (fn?.arguments) cur.function.arguments += fn.arguments;
        calls[i] = cur;
      }
      for (const [k, v] of Object.entries(delta)) if (!["content", "tool_calls", "role"].includes(k)) extra[k] = v;
    }
    // An empty answer (filtered, cut, provider hiccup) is a failure to retry, never a silent "done".
    if (!text && !calls.length) throw new ProviderError("empty", "empty stream");
    const message: AssistantItem = {
      role: "assistant",
      content: text || null,
      ...extra,
      ...(calls.length ? { tool_calls: calls.map((c, i) => ({ ...c, id: c.id || `call_${i}` })) } : {}),
    };
    if (calls.length && finish === "other") finish = "tool_calls";
    return { message, model: req.model, finish, ...(usage ? { usage } : {}) } satisfies Completion;
  } finally {
    done();
  }
};
