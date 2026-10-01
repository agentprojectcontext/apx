// OpenAI-compatible chat completions with tools (Gemini, OpenRouter, Zen, Ollama, LM Studio…).
// The key is resolved per call from a reference, never stored in config or logs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Provider extras (e.g. Gemini thought signatures) must be echoed back verbatim. */
  [extra: string]: unknown;
};

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: object } };

export type LlmConfig = {
  baseUrl: string;
  models: string[];
  /** env:NAME | apx1:<dot.path in ~/.apx/config.json> | literal for tests */
  keyRef: string;
  timeoutMs: number;
};

export type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

export type Completion = {
  message: Extract<ChatMessage, { role: "assistant" }>;
  model: string;
  usage?: Usage;
};

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    baseUrl: env.APX_LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    models: (env.APX_LLM_MODELS ?? "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    keyRef: env.APX_LLM_KEY ? "env:APX_LLM_KEY" : (env.APX_LLM_KEY_REF ?? "apx1:engines.gemini.api_key"),
    timeoutMs: Number(env.APX_LLM_TIMEOUT_MS ?? 45_000),
  };
}

export function resolveKey(ref: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (ref.startsWith("env:")) return env[ref.slice(4)] || undefined;
  if (ref.startsWith("apx1:")) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".apx", "config.json"), "utf8")) as Record<
        string,
        unknown
      >;
      let cur: unknown = cfg;
      for (const k of ref.slice(5).split(".")) cur = (cur as Record<string, unknown> | undefined)?.[k];
      return typeof cur === "string" && cur ? cur : undefined;
    } catch {
      return undefined;
    }
  }
  return ref.startsWith("literal:") ? ref.slice(8) : undefined;
}

export type Llm = {
  /** `onText` switches to streaming and receives the text accumulated so far. */
  complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
    onText?: (soFar: string) => void,
  ): Promise<Completion>;
  label: string;
};

type Delta = {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

/** Reads an OpenAI-style SSE stream into one assistant message, merging tool-call fragments by index. */
async function readStream(
  res: Response,
  onText: (soFar: string) => void,
  onChunk: () => void,
  onUsage: (u: Usage) => void,
): Promise<Completion["message"]> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no response body");
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const calls: ToolCall[] = [];
  const extra: Record<string, unknown> = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk();
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let delta: Delta | undefined;
      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{ delta?: Delta }>;
          error?: { message?: string };
          usage?: Usage;
        };
        if (chunk.error) throw new Error(`stream error: ${chunk.error.message ?? "unknown"}`);
        if (chunk.usage) onUsage(chunk.usage);
        delta = chunk.choices?.[0]?.delta;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("stream error")) throw err;
        continue;
      }
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        onText(text);
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
  }
  // An empty answer (filtered, cut, provider error) is a failure to retry, never a silent "done".
  if (!text && !calls.length) throw new Error("empty stream");
  return {
    role: "assistant",
    content: text || null,
    ...extra,
    ...(calls.length ? { tool_calls: calls.map((c, i) => ({ ...c, id: c.id || `call_${i}` })) } : {}),
  };
}

export function createLlm(cfg: LlmConfig, fetchImpl: typeof fetch = fetch): Llm {
  return {
    label: cfg.models[0] ?? "none",
    async complete(messages, tools, signal, onText) {
      const key = resolveKey(cfg.keyRef);
      if (!key) throw new Error(`no LLM key (ref ${cfg.keyRef.split(":")[0]}); set APX_LLM_KEY`);
      let lastErr = "no models configured";
      for (const model of cfg.models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal.aborted) throw new Error("canceled");
          // Timeout until the first byte, then an idle timer: long streamed answers must not be cut mid-way.
          const deadline = new AbortController();
          let idle = setTimeout(() => deadline.abort(new Error("first-byte timeout")), cfg.timeoutMs);
          const armIdle = () => {
            clearTimeout(idle);
            idle = setTimeout(() => deadline.abort(new Error("stream idle timeout")), 30_000);
          };
          const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              ...(tools.length ? { tools, tool_choice: "auto" } : {}),
              ...(onText ? { stream: true, stream_options: { include_usage: true } } : {}),
            }),
            signal: AbortSignal.any([signal, deadline.signal]),
          }).catch((e: unknown) => {
            if (signal.aborted) throw new Error("canceled");
            return { ok: false, status: 0, text: async () => String(e) } as unknown as Response;
          });
          if (res.ok && onText) {
            try {
              let usage: Usage | undefined;
              const message = await readStream(res, onText, armIdle, (u) => {
                usage = u;
              });
              return { message, model, ...(usage ? { usage } : {}) };
            } catch (err) {
              if (signal.aborted) throw new Error("canceled");
              lastErr = `${model}: stream failed: ${String(err)}`;
              continue;
            } finally {
              clearTimeout(idle);
            }
          }
          const raw = await res.text().finally(() => clearTimeout(idle));
          if (res.ok) {
            const body = JSON.parse(raw) as {
              choices?: Array<{ message?: Completion["message"] }>;
              usage?: Completion["usage"];
            };
            const message = body.choices?.[0]?.message;
            if (message)
              return {
                message: { ...message, role: "assistant" },
                model,
                ...(body.usage ? { usage: body.usage } : {}),
              };
            lastErr = `${model}: empty response`;
            break;
          }
          lastErr = `${model}: HTTP ${res.status} ${raw.slice(0, 200)}`;
          // Overload and rate limits are worth one retry and then the next model; anything else is not.
          if (![0, 429, 500, 502, 503, 504].includes(res.status)) break;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      throw new Error(lastErr);
    },
  };
}
