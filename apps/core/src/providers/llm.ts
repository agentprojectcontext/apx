// The one way the core calls a model API. Walks the models it is given (the router's order), retries what is worth
// retrying and moves down the list for this call only (the next call starts from the top again).
import type { ProviderConfig } from "../config.ts";
import { parseRef } from "../domain/refs.ts";
import type { Secrets } from "../secrets.ts";
import { anthropicMessages } from "./anthropic-messages.ts";
import { chatgptResponses } from "./chatgpt-responses.ts";
import { openaiChat } from "./openai-chat.ts";
import {
  type ChatItem,
  type Completion,
  type ModelFailure,
  ProviderError,
  type ToolSpec,
  type Transport,
  type Usage,
} from "./types.ts";
import { readsImages } from "./vision.ts";
import { contextWindow } from "./windows.ts";

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
  /** Stable per conversation (a thread id), for providers' prompt caches. */
  cacheKey?: string | undefined;
  maxOutputTokens?: number | undefined;
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
export type SignIn = {
  has(): boolean;
  credentials(): Promise<{ token: string; headers: Record<string, string> }>;
  /** A fresh token after the API refused the current one. */
  renew?(): Promise<{ token: string; headers: Record<string, string> }>;
};

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
      const limited: ProviderError[] = [];
      // A key, a model or a request the owner must fix: told as such even when another model hit a limit.
      let broken: ProviderError | undefined;
      const skipped = new Set<string>();
      const failed: ModelFailure[] = [];
      const need = tokensOf(req);
      const messages = withImageBytes(req.messages, opts.media);
      // A model known not to read images refuses a call carrying any: it gets the words alone.
      const wordsOnly = withoutImages(messages);
      // A model that failed after streaming part of an answer must not leave that part on screen.
      let streamed = false;
      const onText =
        req.onText &&
        ((s: string) => {
          streamed = true;
          req.onText?.(s);
        });
      for (const t of list) {
        if (skipped.has(t.provider.id)) continue;
        const ref = `${t.provider.id}/${t.model}`;
        const window = contextWindow(ref);
        if (window && need > window) {
          failed.push({
            model: ref,
            why: `its context (${kTokens(window)}) is smaller than this chat (${kTokens(need)})`,
          });
          continue;
        }
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
            failed.push({ model: ref, why: `signed out (${last.message.slice(t.provider.id.length + 2, 200)})` });
          }
        } else key = t.provider.key === NO_KEY ? "" : secrets.resolve(t.provider.key);
        if (key === undefined || (key === "" && t.provider.key !== NO_KEY)) {
          skipped.add(t.provider.id);
          if (failed.at(-1)?.model !== ref) failed.push({ model: ref, why: signIn ? "not signed in" : "no API key" });
          continue;
        }
        let renewedToken = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          req.signal.throwIfAborted();
          try {
            const out = await TRANSPORTS[t.provider.transport]({
              baseUrl: t.provider.base_url,
              key,
              model: t.model,
              effort: t.effort,
              headers,
              messages: readsImages(ref) === false ? wordsOnly : messages,
              tools: req.tools,
              signal: req.signal,
              cacheKey: req.cacheKey,
              maxOutputTokens: req.maxOutputTokens,
              onText,
              firstByteMs: opts.firstByteMs,
              fetchImpl: opts.fetchImpl ?? fetch,
            });
            if (t.provider.transport === "openai-chat") checkNotCut(out.usage, need);
            return {
              ...out,
              model: ref,
              ...(t.effort ? { effort: t.effort } : {}),
              ...(failed.length ? { failed } : {}),
            };
          } catch (err) {
            if (req.signal.aborted) throw req.signal.reason ?? err;
            last = err instanceof ProviderError ? err : new ProviderError("network", String(err));
            last.message = `${ref}: ${last.message}`;
            // A plan's token can be refused before it says it expires: renew it once and try again.
            if (last.kind === "auth" && signIn?.renew && !renewedToken) {
              renewedToken = true;
              try {
                const c = await signIn.renew();
                key = c.token;
                headers = c.headers;
                attempt--;
                continue;
              } catch (renewErr) {
                last.message += ` (sign-in could not be renewed: ${renewErr instanceof Error ? renewErr.message : String(renewErr)})`;
              }
            }
            // Auth and a rejected request rule out the whole provider for this call; quota is often per model
            // (Gemini), so the provider's next model still gets a try.
            if (last.kind === "auth" || last.kind === "bad_request") skipped.add(t.provider.id);
            if (!last.retryable || attempt === 1) break;
            await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 800));
          }
        }
        if (last) failed.push({ model: ref, why: last.message.slice(ref.length + 2, ref.length + 302) });
        if (last?.limit) limited.push(last);
        if (last && (last.kind === "auth" || last.kind === "model_gone" || last.kind === "bad_request"))
          broken ??= last;
        if (streamed) {
          streamed = false;
          req.onText?.("");
        }
      }
      // Every model's reason, not only the last one's: the owner needs to see why the first choice failed.
      const reasons = failed.map((f) => `${f.model}: ${f.why}`).join("\n");
      if (limited.length && !broken) throw limitError(limited, reasons);
      throw new ProviderError(
        broken?.kind ?? last?.kind ?? "auth",
        reasons || last?.message || "no usable model provider",
      );
    },
  };
}

/**
 * Some model of the chain hit its provider's limit, none answered and nothing needs the owner's fix: the work waits
 * for a limit to lift. It can go on at the earliest reset any of them gave.
 */
function limitError(limited: ProviderError[], reasons: string): ProviderError {
  const kind = limited.some((e) => e.kind === "quota") ? "quota" : "rate_limit";
  const resets = limited.flatMap((e) => (e.resetsAt ? [e.resetsAt] : [])).sort();
  return new ProviderError(kind, reasons, resets[0]);
}

/** A rough token count of a call (four characters each), enough to tell a 60k chat from a 4k window. */
function tokensOf(req: LlmRequest): number {
  return Math.ceil((JSON.stringify(req.messages).length + JSON.stringify(req.tools).length) / 4);
}

const kTokens = (n: number) => `${Math.round(n / 1000)}k tokens`;

/**
 * A local server (Ollama) cuts a prompt longer than its context length without saying so: the model then answers
 * without the system prompt or the tools. The cut reports exactly its context length (4096, 8192…) as the input, far
 * below what was sent. Any other small figure is a prompt cache counting only new tokens, not a cut.
 */
function checkNotCut(usage: Usage | undefined, need: number): void {
  const n = usage?.input ?? 0;
  const contextSized = n >= 2048 && (n & (n - 1)) === 0;
  if (!contextSized || need < 8_000 || n * 3 > need) return;
  throw new ProviderError(
    "context",
    `the server read only ${kTokens(n)} of this chat (${kTokens(need)}): raise its context length`,
  );
}

function withoutImages(messages: ChatItem[]): ChatItem[] {
  return messages.map((m) => {
    if (m.role !== "user" || !m.images) return m;
    const { images: _i, ...rest } = m;
    return rest;
  });
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
