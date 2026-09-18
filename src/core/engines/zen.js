// OpenCode Zen — an OpenAI-compatible gateway in front of many vendors'
// models: Claude, GPT, Gemini, Grok, GLM, Kimi and DeepSeek on one base URL
// and one key.
//
// The free models used to be the reason this engine existed — they billed at
// zero, which made them a real option for an agent that runs all day. They are
// no longer reachable from here; see the next block. What is left is the paid
// catalog, and that needs a real key like any other provider's.
import { randomBytes } from "node:crypto";
import { createOpenAiCompatibleEngine } from "./openai-compatible.js";
import { matchesModelGlob, modelListFromConfig } from "./_globs.js";

// THE FREE TIER IS CLOSED TO APX. Measured against the live gateway on
// 2026-09-18: every free model (big-pickle, nemotron-*-free, mimo-v2.5-free,
// ling-3.0-flash-fin-free) answers
//   403 FreeTierError — "OpenCode's free tier can only be used from within
//   OpenCode"
// for every request APX can make — with a real Zen key or with "public",
// with these headers or without them. Only the PAID models on this base URL
// still work, and those need a real key.
//
// What the gate actually checks, bisected against a request captured from the
// real opencode client (which does still get 200 from this same machine and
// the same IP, so it is not an address block):
//   1. `stream: true` — a non-streaming call is 403 whatever else it carries.
//   2. a tools array declaring tools NAMED `bash` and `read` — both, by name.
//      Descriptions and schemas are not inspected and extra tools are fine,
//      but any other set is 403, including opencode's own tools renamed.
//   3. the `x-opencode-session` header, still, non-empty.
//
// APX's tools are `run_shell` / `read_file`, and only the surfaces that stream
// set `stream: true` — so no APX call clears (1) and (2) today, and clearing
// them would mean declaring tools the agent does not have for the sole
// purpose of passing the check. This is a deliberate anti-circumvention gate:
// it has moved three times (429 on the UA, then 400 MissingSessionID, now
// this), and every move broke every agent pointed at a zen model at once.
// Treat the free tier as gone; point `super_agent.model` somewhere real.
//
// The headers below stay because the paid models' routing still wants them
// and they cost nothing. `engines.zen.headers` overrides any of them from
// config, and a header set to "" there is dropped from the request. One
// session per process on purpose: the gateway pins a session to an upstream
// provider, so a fresh id per call would scatter the turns of one
// conversation across providers and lose the prompt cache.
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

// The literal the gateway used to accept in place of a key on the free tier.
// It buys nothing now — the free models 403 with it and the paid ones 401
// ("Missing API key") — but it is kept as the fallback so a zen config with no
// key still produces the gateway's own answer rather than an APX-side throw,
// and so the shape stays if OpenCode ever reopens the tier. Set a real
// OPENCODE_ZEN_API_KEY / engines.zen.api_key: it is what every model that
// still answers needs.
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

/** Last-resort probe model when neither the caller nor config names one. */
const PROBE_MODEL = "big-pickle";

/** The free models, which no longer answer APX at all (see the note up top). */
const FREE_MODELS = [/^big-pickle$/i, /-free$/i];
const isFreeModel = (m) => FREE_MODELS.some((re) => re.test(String(m || "")));

// Zen serves its catalog to anyone — `GET /models` answers 200 with no key at
// all, and 200 again with a made-up one. The shared health check reads that as
// "connected", so a typo in the key would show a healthy provider that fails on
// the first real turn. Here the probe has to be a completion against the model
// the chain is really asking about: it is the only answer the gateway gives
// that depends on both the key and the model's tier.
export default {
  ...base,

  async health(config = {}, { timeoutMs = 800, candidateModel = null } = {}) {
    // Probe the model the chain is actually asking about. Probing a free model
    // on behalf of a paid one would fail the paid model for the wrong reason,
    // and vice versa — the two now answer differently.
    const model = candidateModel || config?.model || PROBE_MODEL;
    if (isFreeModel(model)) {
      return {
        ok: false,
        provider: "zen",
        reason: `${model}: el free tier de OpenCode ya sólo responde al cliente opencode`,
      };
    }

    const key = config?.api_key || process.env.OPENCODE_ZEN_API_KEY || ZEN_PUBLIC_API_KEY;
    if (!key) return { ok: false, provider: "zen", reason: "no api_key" };

    const url = `${String(config?.base_url || base.defaultBaseUrl).replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 4000));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: base.buildHeaders(config, {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        }),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true, provider: "zen", detail: url };
      if (res.status === 401 || res.status === 403) {
        // 403 here is the free-tier gate, not the key; 401 is the key. Saying
        // "api_key rechazada" for both sent people to rotate a key that was
        // fine.
        const body = await res.json().catch(() => null);
        const kind = body?.error?.type === "FreeTierError" ? "free tier cerrado" : "api_key rechazada";
        return { ok: false, provider: "zen", reason: `${kind} por Zen (HTTP ${res.status})` };
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
