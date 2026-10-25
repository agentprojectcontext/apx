// The canonical conversation format inside APX is OpenAI chat completions: every transport converts from it.
// Items carry provider extras (e.g. Gemini thought signatures) that must be echoed back verbatim.
import { errorMessage } from "../errors.ts";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  [extra: string]: unknown;
};

/** An image in a user item: a media reference in the log; `data` (base64) is filled in only for the call. */
export type ChatImage = { media_id: string; mime: string; data?: string };

export type ChatItem =
  | { role: "system"; content: string }
  | { role: "user"; content: string; images?: ChatImage[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown }
  | { role: "tool"; tool_call_id: string; content: string };

export type AssistantItem = Extract<ChatItem, { role: "assistant" }>;

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: object } };

/** Why the model stopped. `length` means the answer was cut and is not complete. */
export type Finish = "stop" | "tool_calls" | "length" | "other";

/** `context`: the input of the last call alone, how much of the window the chat fills now. */
/** `input` counts every prompt token, `cached` the part a provider read from its prompt cache. */
/** `window`: the model's context limit, when the engine says it (else it is looked up by the model's name). */
export type Usage = { input: number; output: number; context?: number; cached?: number; window?: number };

/**
 * `effort`: the reasoning effort the call asked for, when it asked for one. `failed`: models tried before the one
 * that answered, with why each one did not.
 */
export type Completion = {
  message: AssistantItem;
  model: string;
  effort?: string | undefined;
  finish: Finish;
  usage?: Usage;
  failed?: ModelFailure[] | undefined;
};

/** A model the gateway tried and moved past in one call. */
export type ModelFailure = { model: string; why: string };

export type ErrorKind =
  | "rate_limit"
  | "overloaded"
  | "quota"
  | "auth"
  | "bad_request"
  | "model_gone"
  | "network"
  | "empty"
  | "context";

/**
 * A provider failure with what to do about it. `resetsAt` (ISO): when a usage limit lifts, if the provider said so.
 */
export class ProviderError extends Error {
  readonly kind: ErrorKind;
  readonly resetsAt: string | undefined;
  /** The models a whole chain tried before giving up, in order; empty for a single call's error. */
  models: string[] = [];
  constructor(kind: ErrorKind, message: string, resetsAt?: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.resetsAt = resetsAt;
  }
  /** Worth one more try on the same model. */
  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "overloaded" || this.kind === "network" || this.kind === "empty";
  }
  /**
   * The provider's usage limit (its plan or its rate), not a fault of the request or of APX. A rate limit that lifts
   * within a few minutes is a pause, not a stall worth telling the owner.
   */
  get limit(): boolean {
    if (this.kind === "quota") return true;
    return this.kind === "rate_limit" && (!this.resetsAt || Date.parse(this.resetsAt) - Date.now() > PAUSE_MS);
  }
}

export function classifyHttp(status: number, body: string, headers?: Headers): ProviderError {
  const text = body.slice(0, 300);
  if (status === 401 || status === 403) return new ProviderError("auth", `HTTP ${status}: ${text}`);
  if (status === 404) return new ProviderError("model_gone", `HTTP 404: ${text}`);
  if (status === 429) {
    // Providers use 429 both for "slow down" and for "your plan is out"; the body tells them apart.
    const quota = /quota|billing|credit|insufficient|exceeded your current|usage[ _]limit|limit[ _]reached/i.test(body);
    return new ProviderError(quota ? "quota" : "rate_limit", `HTTP 429: ${text}`, resetOf(body, headers));
  }
  if (status === 0 || status >= 500)
    return new ProviderError(status === 0 ? "network" : "overloaded", `HTTP ${status}: ${text}`);
  return new ProviderError("bad_request", `HTTP ${status}: ${text}`);
}

/** A reset further out than this is not believed (a unit mix-up), nor one already past. */
const MAX_RESET_MS = 31 * 86_400_000;
/** A rate limit that lifts sooner than this is a pause. */
const PAUSE_MS = 5 * 60_000;

/** A reset as a time: epoch seconds or milliseconds, or a date string. */
function absolute(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== "string" || !v.trim()) return undefined;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return absolute(Number(v));
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** A wait as milliseconds: seconds as a number, or a duration string ("34s", "1.5s"). */
function relative(v: unknown, now: number): number | undefined {
  const s = typeof v === "number" ? v : typeof v === "string" ? Number(/^\s*([\d.]+)\s*s?\s*$/.exec(v)?.[1]) : NaN;
  return Number.isFinite(s) ? now + s * 1000 : undefined;
}

const ABSOLUTE_KEYS = new Set(["resets_at", "reset_at", "resetsat", "resetat", "x-ratelimit-reset"]);
const RELATIVE_KEYS = new Set(["resets_in_seconds", "retry_after", "retry_after_seconds", "retrydelay"]);

/** The first reset found in a JSON error body, at any depth (the plan's error object, OpenRouter's metadata). */
function resetInBody(value: unknown, now: number, depth = 0): number | undefined {
  if (!value || typeof value !== "object" || depth > 5) return undefined;
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    const at = ABSOLUTE_KEYS.has(key) ? absolute(v) : RELATIVE_KEYS.has(key) ? relative(v, now) : undefined;
    if (at !== undefined) return at;
  }
  for (const v of Object.values(value)) {
    const at = resetInBody(v, now, depth + 1);
    if (at !== undefined) return at;
  }
  return undefined;
}

/** When a 429 lifts, from the Retry-After header or the body, as ISO; undefined when unsaid or implausible. */
export function resetOf(body: string, headers?: Headers, now = Date.now()): string | undefined {
  const header = headers?.get("retry-after");
  let at = header ? (relative(header, now) ?? absolute(header)) : undefined;
  if (at === undefined) {
    try {
      at = resetInBody(JSON.parse(body), now);
    } catch {
      // Not JSON: only the header could say.
    }
  }
  return at !== undefined && at > now && at < now + MAX_RESET_MS ? new Date(at).toISOString() : undefined;
}

export type TransportRequest = {
  baseUrl: string;
  key: string;
  model: string;
  /** Reasoning effort the ref asked for ("#high"), for transports that take one. */
  effort?: string | undefined;
  /** Extra headers a signed-in provider needs (its account). */
  headers?: Record<string, string> | undefined;
  messages: ChatItem[];
  tools: ToolSpec[];
  signal: AbortSignal;
  /** Stable per conversation: lets a provider's prompt cache find this chat's earlier calls. */
  cacheKey?: string | undefined;
  maxOutputTokens?: number | undefined;
  /** Streaming: receives the text accumulated so far. */
  onText?: ((soFar: string) => void) | undefined;
  /** Silence allowed before the first byte. */
  firstByteMs: number;
  fetchImpl: typeof fetch;
};

export type Transport = (req: TransportRequest) => Promise<Completion>;

/**
 * POST with a first-byte timeout that becomes an idle timer once bytes flow, so long streamed answers are not cut.
 * Returns the response and a `touch` to call on every chunk, plus `done` to clear the timer.
 */
export async function post(
  req: Pick<TransportRequest, "signal" | "firstByteMs" | "fetchImpl">,
  url: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const deadline = new AbortController();
  let timer = setTimeout(() => deadline.abort(new Error("first-byte timeout")), req.firstByteMs);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => deadline.abort(new Error("stream idle timeout")), 30_000);
  };
  const done = () => clearTimeout(timer);
  try {
    const res = await req.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.any([req.signal, deadline.signal]),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      done();
      throw classifyHttp(res.status, text, res.headers);
    }
    return { res, touch, done };
  } catch (err) {
    done();
    req.signal.throwIfAborted();
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("network", errorMessage(err));
  }
}

/** Server-sent events: yields each `data:` payload, including a last line without a trailing newline. */
export async function* sseData(res: Response, onChunk: () => void): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderError("empty", "no response body");
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      onChunk();
      buf += decoder.decode(value, { stream: true });
    }
    if (done) buf += "\n";
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
    if (done) return;
  }
}
