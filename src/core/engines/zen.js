// OpenCode Zen — an OpenAI-compatible gateway in front of many vendors'
// models, including a handful the provider serves at no cost.
//
// The free models are the reason this engine exists: with a Zen key they bill
// at zero, which makes them a real option for an agent that runs all day. The
// key is not optional, though. Zen also fronts paid Claude/GPT/Gemini models on
// the same base URL, and the same key is what tells the two apart — so it is
// required here like any other provider's.
import { randomBytes } from "node:crypto";
import { createOpenAiCompatibleEngine } from "./openai-compatible.js";
import { fetchThrough } from "../net/proxy.js";
import { matchesModelGlob, modelListFromConfig } from "./_globs.js";

// The free tier is gated on the caller looking like the opencode client rather
// than on the key — and since 2026-09-07 that takes two headers, not one:
//
//   user-agent: opencode/<version>
//     Old news: byte-for-byte the same request answers 429 FreeUsageLimitError
//     without it and 200 with it.
//   x-opencode-session: <non-empty id>
//     New, and what broke every Zen call at once: without it the gateway
//     answers 400 MissingSessionID — "OpenCode's free tier can only be used in
//     OpenCode". An empty value counts as missing.
//
// Nothing changed in the opencode client: it has sent this header on every
// `opencode*` call for months (session/llm/request.ts), together with the
// request, client and project ids. What changed is the gateway
// (console/.../zen/util/handler.ts), which now routes the free models through
// its own "Console" inference backend and forwards those headers to it — and
// Console rejects a request that carries no session.
//
// The values are not validated (any non-empty string answers 200), but we mint
// opencode-shaped ids anyway, and keep ONE session per process: the gateway
// pins a session to an upstream provider, so a fresh id per call would scatter
// the turns of one conversation across providers and lose the prompt cache.
//
// Pins go stale. `engines.zen.headers` overrides any of these from config, and
// a header set to "" there is dropped from the request altogether.
export const ZEN_USER_AGENT = "opencode/1.18.29";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let idClock = 0;
let idCounter = 0;

/**
 * An id in opencode's own shape (schema/identifier.ts): `<prefix>_`, then 12
 * hex chars encoding `(ms << 12) | counter` — one's-complemented when the ids
 * are meant to sort newest first — then 14 random base62 chars.
 */
function opencodeId(prefix, { descending = true } = {}) {
  const now = Date.now();
  if (now !== idClock) {
    idClock = now;
    idCounter = 0;
  }
  idCounter++;
  const current = BigInt(now) * 0x1000n + BigInt(idCounter);
  const value = descending ? ~current : current;
  const time = Array.from({ length: 6 }, (_, i) =>
    Number((value >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, "0")
  ).join("");
  const rand = Array.from(randomBytes(14), (b) => ID_ALPHABET[b % 62]).join("");
  return `${prefix}_${time}${rand}`;
}

/** One session per process — see the note above on sticky routing. */
export const ZEN_SESSION_ID = opencodeId("ses");

/**
 * Every header a Zen call carries. A function rather than a constant because
 * the request id is per call; the UA and the session id are not.
 */
export function zenHeaders() {
  return {
    "user-agent": ZEN_USER_AGENT,
    "x-opencode-session": ZEN_SESSION_ID,
    "x-opencode-request": opencodeId("msg", { descending: false }),
    "x-opencode-client": "cli",
  };
}

// Which models demand their own thinking back on every subsequent request.
//
// DeepSeek's thinking mode treats `reasoning_content` as part of the assistant
// turn, not as a by-product of it: replay the turn without it and the upstream
// answers
//   400 [invalid_request_error] The `reasoning_content` in the thinking mode
//       must be passed back to the API.
// The first turn always works, so this only bites once the loop has an
// assistant turn in history — i.e. the long, tool-heavy turns.
//
// Same mechanism as Gemini's thought signatures, and scoped the same way: a
// glob list, one entry per family. Scoped to v4+ ON PURPOSE — the older
// reasoners (deepseek-r1, deepseek-v3) do the exact opposite and 400 when
// `reasoning_content` appears in the context, so widening this to `deepseek-*`
// would trade one failure for another. v5 is a forward default: the
// requirement is a family trait, not a per-version quirk.
export const REASONING_REPLAY_MODELS = ["deepseek-v4*", "deepseek-v5*"];

// Per-install override, no code change required:
//   engines.zen.reasoning_replay_models: ["deepseek-v4*", "some-new-reasoner*"]
export function modelReplaysReasoning(model, config = {}) {
  return matchesModelGlob(
    model,
    modelListFromConfig(config?.reasoning_replay_models, REASONING_REPLAY_MODELS)
  );
}

/**
 * Put `reasoning_content` back on assistant turns for the models that require
 * it. `run-agent.js` stores it as `_reasoning` on the turn it came from; the
 * underscore keeps it off the wire for every other model, since the shared
 * serialiser copies only the fields it knows.
 *
 * When the field is missing there is nothing to do and nothing to invent — a
 * turn inherited from another engine after a fallback rotation never had one.
 * That case is caught by the retry classifier, which rotates off the model
 * instead of failing the run.
 */
function replayReasoningContent(entry, source, { model, config }) {
  if (entry.role !== "assistant") return;
  if (!modelReplaysReasoning(model, config)) return;
  const reasoning = source?._reasoning || source?.reasoning_content;
  if (typeof reasoning === "string" && reasoning) entry.reasoning_content = reasoning;
}

// Free-tier key. With zenHeaders() the gateway answers 200 for big-pickle and
// the other *-free models; without the UA it answers 429 FreeUsageLimitError
// and without the session header 400 MissingSessionID, valid key or not.
// Prefer a real OPENCODE_ZEN_API_KEY / engines.zen api_key when present (paid
// models need one); fall back to "public" so agents are never left keyless on
// the free tier.
export const ZEN_PUBLIC_API_KEY = "public";

const base = createOpenAiCompatibleEngine({
  id: "zen",
  defaultBaseUrl: "https://opencode.ai/zen/v1",
  apiKeyEnv: "OPENCODE_ZEN_API_KEY",
  defaultFallbackModel: "zen:big-pickle",
  extraHeaders: zenHeaders,
  decorateMessage: replayReasoningContent,
  defaultApiKey: ZEN_PUBLIC_API_KEY,
});

/** The cheapest model that still proves a key works: free, one token. */
const PROBE_MODEL = "big-pickle";

// Zen serves its catalog to anyone — `GET /models` answers 200 with no key at
// all, and 200 again with a made-up one. The shared health check reads that as
// "connected", so a typo in the key would show a healthy provider that fails on
// the first real turn. Here the probe has to be a completion: one token against
// a free model, which costs nothing and is the only answer the gateway gives
// that actually depends on the key. Empty config still probes with "public".
export default {
  ...base,

  async health(config = {}, { timeoutMs = 800 } = {}) {
    const key = config?.api_key || process.env.OPENCODE_ZEN_API_KEY || ZEN_PUBLIC_API_KEY;
    if (!key) return { ok: false, provider: "zen", reason: "no api_key" };

    const url = `${String(config?.base_url || base.defaultBaseUrl).replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 4000));
    try {
      const res = await fetchThrough(config?.proxy)(url, {
        method: "POST",
        headers: base.buildHeaders(config, {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        }),
        body: JSON.stringify({
          model: config?.model || PROBE_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true, provider: "zen", detail: url };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, provider: "zen", reason: "api_key rechazada por Zen" };
      }
      // Anything else (a rate limit, a model that went away) says nothing about
      // the key, so the chain is allowed to try — flagged, not blocked.
      return { ok: true, provider: "zen", detail: url, soft: true, reason: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: true, provider: "zen", detail: url, soft: true, reason: e.message };
    } finally {
      clearTimeout(timer);
    }
  },
};
