// The one way the core calls a model API. Walks the models it is given (the router's order), retries what is worth
// retrying and moves down the list for this call only (the next call starts from the top again).
import type { ProviderConfig } from "../config.ts";
import { parseRef } from "../domain/refs.ts";
import type { Secrets } from "../secrets.ts";
import { anthropicMessages } from "./anthropic-messages.ts";
import { chatgptResponses } from "./chatgpt-responses.ts";
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
  "chatgpt-responses": chatgptResponses,
};

type Target = { provider: ProviderConfig; model: string; effort?: string | undefined };

/** A provider signed in rather than keyed (oauth:<name>): whether it is, and a fresh token with its headers. */
export type SignIn = { has(): boolean; credentials(): Promise<{ token: string; headers: Record<string, string> }> };

/** The key reference of a provider that needs none (a local server). */
export const NO_KEY = "none";

export function createLlm(opts: {
  /** Read on every call: a provider the owner adds or changes applies to the next one. */
  providers: () => ProviderConfig[];
  secrets: Secrets;
  firstByteMs: number;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  /** Bytes of an image the log references (base64), read only right before a call. */
  media?: (id: string) => { mime: string; data: string } | undefined;
  /** Sign-ins by key reference ("oauth:chatgpt"). */
  signIns?: Record<string, SignIn>;
}): Llm {
  const { secrets } = opts;

  function targets(refs: string[]): Target[] {
    return refs.flatMap((ref) => {
      const { engine, model, effort } = parseRef(ref);
      const provider = opts.providers().find((p) => p.id === engine);
      if (!provider) return [];
      return model ? [{ provider, model, effort }] : provider.models.map((m) => ({ provider, model: m }));
    });
  }

  return {
    label() {
      const ids = opts
        .providers()
        .filter((p) => p.key === NO_KEY || secrets.has(p.key) || Boolean(opts.signIns?.[p.key]?.has()))
        .map((p) => p.id);
      return ids.length ? ids.join(", ") : "none";
    },
    async complete(req) {
      const list = targets(req.models);
      if (!list.length)
        throw new ProviderError(
          "model_gone",
          `no model to run (${req.models.join(", ") || "none chosen"}); pick one in Settings → Engines and models`,
        );
      let last: ProviderError | undefined;
      const skipped = new Set<string>();
      const messages = withImageBytes(req.messages, opts.media);
      for (const t of list) {
        if (skipped.has(t.provider.id)) continue;
        // A local server (Ollama, LM Studio) needs no key; a signed-in plan gets a fresh token per call.
        const signIn = opts.signIns?.[t.provider.key];
        let headers: Record<string, string> | undefined;
        let key: string | undefined;
        if (signIn) {
          try {
            const c = signIn.has() ? await signIn.credentials() : undefined;
            key = c?.token;
            headers = c?.headers;
          } catch (err) {
            last = new ProviderError("auth", `${t.provider.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else key = t.provider.key === NO_KEY ? "" : secrets.resolve(t.provider.key);
        if (key === undefined || (key === "" && t.provider.key !== NO_KEY)) {
          skipped.add(t.provider.id);
          continue;
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          req.signal.throwIfAborted();
          try {
            const out = await TRANSPORTS[t.provider.transport]({
              baseUrl: t.provider.base_url,
              key,
              model: t.model,
              effort: t.effort,
              headers,
              messages,
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

/** Images a call carries at most: the newest ones; older ones stay named in their message's text. */
const MAX_CALL_IMAGES = 4;

/**
 * Images travel as references in the log; their bytes join only this call, newest first up to the cap (an image no
 * longer on disk is dropped).
 */
function withImageBytes(
  messages: ChatItem[],
  media: ((id: string) => { mime: string; data: string } | undefined) | undefined,
): ChatItem[] {
  let room = MAX_CALL_IMAGES;
  return messages
    .toReversed()
    .map((m) => {
      if (m.role !== "user" || !m.images?.length) return m;
      const images = m.images.toReversed().flatMap((i) => {
        if (room <= 0) return [];
        const got = media?.(i.media_id);
        if (!got) return [];
        room--;
        return [{ ...i, mime: got.mime, data: got.data }];
      });
      return { ...m, images: images.toReversed() };
    })
    .toReversed();
}
