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

/** User items with images become content parts (text, then each image as a data URL); the rest go as they are. */
function wire(items: TransportRequest["messages"]): unknown[] {
  return items.map((m) => {
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

function parses(json: string): boolean {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
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
      messages: wire(req.messages),
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
    // A stream that stopped without a finish reason in the middle of a tool call's arguments was cut: retried, never
    // run with half its input. A finished call with bad JSON still reaches the tool, whose error the model can fix.
    const cut = finish === "other" && calls.find((c) => c.function.arguments.trim() && !parses(c.function.arguments));
    if (cut)
      throw new ProviderError("empty", `stream cut inside the arguments of ${cut.function.name || "a tool call"}`);
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
