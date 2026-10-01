// The one way the core calls a model. Picks provider and model, retries what is worth retrying and falls back
// down the chain for this call only (the next call starts from the top again).
import type { ProviderConfig } from "../config.ts";
import type { Secrets } from "../secrets.ts";
import { anthropicMessages } from "./anthropic-messages.ts";
import { openaiChat } from "./openai-chat.ts";
import { type ChatItem, type Completion, ProviderError, type ToolSpec, type Transport } from "./types.ts";

export type LlmRequest = {
  /** "provider/model", a bare model name, or undefined for the default chain. */
  model?: string | undefined;
  messages: ChatItem[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText?: ((soFar: string) => void) | undefined;
};

export type Llm = {
  /** What answers by default ("gemini/gemini-3.8-flash"), for health and the UI. */
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
  const usable = () => providers.filter((p) => secrets.has(p.key));

  /** The models to try, in order. A named model goes first; the default chain follows as fallback. */
  function chain(model: string | undefined): Target[] {
    const defaults = usable().flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));
    if (!model) return defaults;
    const slash = model.indexOf("/");
    const named = slash > 0 ? providers.find((p) => p.id === model.slice(0, slash)) : undefined;
    const first: Target | undefined = named
      ? { provider: named, model: model.slice(slash + 1) }
      : (() => {
          const owner = usable().find((p) => p.models.includes(model)) ?? usable()[0];
          return owner ? { provider: owner, model } : undefined;
        })();
    if (!first) return defaults;
    return [first, ...defaults.filter((t) => !(t.provider.id === first.provider.id && t.model === first.model))];
  }

  return {
    label() {
      const t = chain(undefined)[0];
      return t ? `${t.provider.id}/${t.model}` : "none";
    },
    async complete(req) {
      const targets = chain(req.model);
      if (!targets.length)
        throw new ProviderError("auth", "no model provider has a key; add one with `apx2 secrets set gemini`");
      let last: ProviderError | undefined;
      const skipped = new Set<string>();
      for (const t of targets) {
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
            // Auth, quota and a rejected request rule out the whole provider for this call; another may still work.
            if (last.kind === "auth" || last.kind === "quota" || last.kind === "bad_request")
              skipped.add(t.provider.id);
            if (!last.retryable || attempt === 1) break;
            await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 800));
          }
        }
      }
      throw last ?? new ProviderError("auth", "no usable model provider");
    },
  };
}
