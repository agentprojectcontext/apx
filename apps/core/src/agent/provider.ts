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

export type Completion = {
  message: Extract<ChatMessage, { role: "assistant" }>;
  model: string;
  usage?: { total_tokens?: number };
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
  complete(messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<Completion>;
  label: string;
};

export function createLlm(cfg: LlmConfig, fetchImpl: typeof fetch = fetch): Llm {
  return {
    label: cfg.models[0] ?? "none",
    async complete(messages, tools, signal) {
      const key = resolveKey(cfg.keyRef);
      if (!key) throw new Error(`no LLM key (ref ${cfg.keyRef.split(":")[0]}); set APX_LLM_KEY`);
      let lastErr = "no models configured";
      for (const model of cfg.models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal.aborted) throw new Error("canceled");
          const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(cfg.timeoutMs)]),
          }).catch((e: unknown) => {
            if (signal.aborted) throw new Error("canceled");
            return { ok: false, status: 0, text: async () => String(e) } as unknown as Response;
          });
          const raw = await res.text();
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
