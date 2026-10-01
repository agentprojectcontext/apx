// The one way the core calls a model API. Walks the models it is given (the router's order), retries what is worth
// retrying and moves down the list for this call only (the next call starts from the top again).
import type { ProviderConfig } from "../config.ts";
import type { Secrets } from "../secrets.ts";
import { anthropicMessages } from "./anthropic-messages.ts";
import { openaiChat } from "./openai-chat.ts";
import { type ChatItem, type Completion, ProviderError, type ToolSpec, type Transport } from "./types.ts";

export type LlmRequest = {
  /**
   * Models to try in order, as "provider/model" (or a provider alone: its configured models). The router decides
   * the order; this gateway only walks it, per call.
   */
  models: string[];
  messages: ChatItem[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText?: ((soFar: string) => void) | undefined;
};

export type Llm = {
  /** Providers that have a key, for health and the UI ("gemini, anthropic"). */
  label(): string;
  complete(req: LlmRequest): Promise<Completion>;
};

const TRANSPORTS: Record<ProviderConfig["transport"], Transport> = {
  "openai-chat": openaiChat,
  "anthropic-messages": anthropicMessages,
};

type Target = { provider: ProviderConfig; model: string };

export function createLlm(opts: {
  providers: ProviderConfig[];
  secrets: Secrets;
  firstByteMs: number;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}): Llm {
  const { providers, secrets } = opts;

  function targets(refs: string[]): Target[] {
    return refs.flatMap((ref) => {
      const [id, ...rest] = ref.split("/");
      const provider = providers.find((p) => p.id === id);
      if (!provider) return [];
      const model = rest.join("/");
      return model ? [{ provider, model }] : provider.models.map((m) => ({ provider, model: m }));
    });
  }

  return {
    label() {
      const ids = providers.filter((p) => secrets.has(p.key)).map((p) => p.id);
      return ids.length ? ids.join(", ") : "none";
    },
    async complete(req) {
      const list = targets(req.models);
      if (!list.length)
        throw new ProviderError(
          "model_gone",
          `no model to run (${req.models.join(", ") || "none chosen"}); pick one in Config → Models`,
        );
      let last: ProviderError | undefined;
      const skipped = new Set<string>();
      for (const t of list) {
        if (skipped.has(t.provider.id)) continue;
        const key = secrets.resolve(t.provider.key);
        if (!key) {
          skipped.add(t.provider.id);
          continue;
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          if (req.signal.aborted) throw req.signal.reason ?? new Error("canceled");
          try {
            const out = await TRANSPORTS[t.provider.transport]({
              baseUrl: t.provider.base_url,
              key,
              model: t.model,
              messages: req.messages,
              tools: req.tools,
              signal: req.signal,
              onText: req.onText,
              firstByteMs: opts.firstByteMs,
              fetchImpl: opts.fetchImpl ?? fetch,
            });
            return { ...out, model: `${t.provider.id}/${t.model}` };
          } catch (err) {
            if (req.signal.aborted) throw req.signal.reason ?? err;
            last = err instanceof ProviderError ? err : new ProviderError("network", String(err));
            last.message = `${t.provider.id}/${t.model}: ${last.message}`;
            // Auth and a rejected request rule out the whole provider for this call; quota is often per model
            // (Gemini), so the provider's next model still gets a try.
            if (last.kind === "auth" || last.kind === "bad_request") skipped.add(t.provider.id);
            if (!last.retryable || attempt === 1) break;
            await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 800));
          }
        }
      }
      throw last ?? new ProviderError("auth", "no usable model provider");
    },
  };
}
