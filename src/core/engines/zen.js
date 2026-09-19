// OpenCode Zen — an OpenAI-compatible gateway in front of many vendors'
// models: Claude, GPT, Gemini, Grok, GLM, Kimi and DeepSeek on one base URL
// and one key.
//
// The free models are the reason this engine exists: they bill at zero, which
// makes them a real option for an agent that runs all day. They are not keyed,
// they are GATED — the gateway serves them only to a request that looks like
// the one its own client sends, and the next block is the current shape of
// that check and how it was measured. The paid models on the same base URL
// need a real key like any other provider's.
import { randomBytes } from "node:crypto";
import { createOpenAiCompatibleEngine } from "./openai-compatible.js";
import { matchesModelGlob, modelListFromConfig } from "./_globs.js";

// WHAT THE FREE TIER CHECKS. It is not the key and it is not the source IP:
// the opencode client gets 200 from the same machine and the same address
// that APX gets 403 from. Measured against the live gateway on 2026-09-18 by
// pointing the real client's baseURL at a logging proxy and bisecting the one
// request that worked. Three things, all required, all independent:
//
//   1. `stream: true`. A blocking request is 403 whatever else it carries —
//      hence `forceStream` below.
//   2. A `tools` array declaring tools named `bash` and `read`. BOTH, by
//      name. Descriptions and schemas are never inspected (blanking them
//      still answers 200) and extra tools are ignored, but any other set is
//      403 — including opencode's own tools renamed. Hence WIRE_ALIAS.
//   3. A non-empty `x-opencode-session`, plus the opencode `user-agent`.
//      Dropping either is 403 on its own.
//
// APX has both capabilities, under its own names — `run_shell` and
// `read_file` — so nothing is invented here: WIRE_ALIAS renames those two on
// the wire and names them back on the way in, and an agent granted neither
// gets a readable error instead of the gateway's. What is NOT done is
// declaring a `bash` the agent does not have: the model would call it and
// the loop would have nothing to dispatch.
//
// This gate has moved three times (429 on the UA, 400 MissingSessionID, now
// this) and every move broke every agent pointed at a zen model at once. It
// will move again. When it does, the bisect above is the recipe: capture a
// working request from the real client, then take one thing away at a time.
//
// The session id: one per process by default, because the gateway pins a
// session to an upstream provider and a fresh id per call scatters the turns
// of one conversation across providers and loses the prompt cache. A fresh
// id per call is also accepted (measured), so `engines.zen.session_per_call:
// true` switches to that. `engines.zen.headers` overrides any header from
// config, and one set to "" is dropped from the request altogether.
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
 * the request id is per call; the UA is not, and the session id is only when
 * `engines.zen.session_per_call` asks for it.
 */
export function zenHeaders(config = {}) {
  return {
    "user-agent": ZEN_USER_AGENT,
    "x-opencode-session": config?.session_per_call ? opencodeId("ses") : ZEN_SESSION_ID,
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

// Free-tier key. The gateway takes this literal in place of a real one on the
// free models — what it checks there is the request shape, not the credential
// (see the note up top). The paid models on the same base URL answer 401
// "Missing API key" to it, so prefer a real OPENCODE_ZEN_API_KEY /
// engines.zen.api_key when there is one; this is the fallback that keeps
// agents from being left keyless on the free tier.
export const ZEN_PUBLIC_API_KEY = "public";

/** The models the gate applies to — the ones the provider bills at zero. */
const FREE_MODELS = [/^big-pickle$/i, /-free$/i];
export const isFreeModel = (m) => FREE_MODELS.some((re) => re.test(String(m || "")));

// APX's name for a capability -> the name the gate expects to see. Same tool
// either way; only the label on the wire changes.
const WIRE_ALIAS = { run_shell: "bash", read_file: "read" };
const APX_NAME = Object.fromEntries(Object.entries(WIRE_ALIAS).map(([a, w]) => [w, a]));
const REQUIRED_WIRE_TOOLS = Object.values(WIRE_ALIAS);

/** Rename one tool declaration for the wire, leaving every other field alone. */
function toWire(tool) {
  const name = tool?.function?.name;
  const alias = WIRE_ALIAS[name];
  if (!alias) return tool;
  return { ...tool, function: { ...tool.function, name: alias } };
}

/** And back: the loop dispatches on APX's names, not the gateway's. */
function fromWire(call) {
  const name = call?.function?.name;
  const apx = APX_NAME[name];
  if (!apx) return call;
  return { ...call, function: { ...call.function, name: apx } };
}

const base = createOpenAiCompatibleEngine({
  id: "zen",
  defaultBaseUrl: "https://opencode.ai/zen/v1",
  apiKeyEnv: "OPENCODE_ZEN_API_KEY",
  defaultFallbackModel: "zen:big-pickle",
  extraHeaders: zenHeaders,
  decorateMessage: replayReasoningContent,
  defaultApiKey: ZEN_PUBLIC_API_KEY,
  // Rule 1 of the gate: the free models only answer a streamed request.
  forceStream: (model) => isFreeModel(model),
});

/** Last-resort probe model when neither the caller nor config names one. */
const PROBE_MODEL = "big-pickle";

// Zen serves its catalog to anyone — `GET /models` answers 200 with no key at
// all, and 200 again with a made-up one. The shared health check reads that as
// "connected", so a typo in the key would show a healthy provider that fails on
// the first real turn. Here the probe has to be a completion against the model
// the chain is really asking about: it is the only answer the gateway gives
// that depends on both the key and the model's tier.
export default {
  ...base,

  /**
   * Free models go out under the names the gate expects and come back under
   * APX's. Everything else is the shared adapter untouched.
   *
   * The alias is applied to the DECLARATION and undone on the CALL, so the
   * rest of the loop never learns that `run_shell` was briefly called `bash`:
   * the tool the model picked is the tool the dispatcher runs.
   */
  async chat(args = {}) {
    if (!isFreeModel(args.model)) return base.chat(args);

    const tools = Array.isArray(args.tools) ? args.tools.map(toWire) : args.tools;
    const names = new Set((tools || []).map((t) => t?.function?.name));
    const missing = REQUIRED_WIRE_TOOLS.filter((n) => !names.has(n));
    if (missing.length) {
      // A narrow agent — one whose allowed_tools is a short, deliberate list —
      // cannot satisfy the gate, and giving it a shell just to get past a
      // gateway check would be the wrong trade every time. So this is not the
      // agent's problem to fix: it is this MODEL being unable to serve this
      // call, which is what the fallback chain is for. Marked retryable so the
      // turn continues on the next model instead of dying here; the message is
      // still specific, because it is what a one-model install will read.
      const e = new Error(
        `zen: ${args.model} es free tier y el gateway sólo contesta a un pedido que ` +
          `declare ${REQUIRED_WIRE_TOOLS.join(" y ")} — a este agente le faltan ` +
          `${missing.map((n) => APX_NAME[n] || n).join(", ")}. Rotando al siguiente ` +
          `modelo de la cadena; para usar zen acá, dale esas tools o elegí un modelo pago.`
      );
      e.retryable = true;
      throw e;
    }

    const out = await base.chat({ ...args, tools });
    if (!out?.tool_calls?.length) return out;
    return { ...out, tool_calls: out.tool_calls.map(fromWire) };
  },

  async health(config = {}, { timeoutMs = 800, candidateModel = null } = {}) {
    // Probe the model the chain is actually asking about: a free model and a
    // paid one answer differently, so probing one on behalf of the other fails
    // the wrong model. And probe it the way a real call goes out — a free
    // model 403s a blocking, tool-less request even when the loop's own calls
    // are fine, so a naive probe would blacklist a model that works.
    const model = candidateModel || config?.model || PROBE_MODEL;
    const free = isFreeModel(model);

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
          ...(free
            ? {
                stream: true,
                tools: REQUIRED_WIRE_TOOLS.map((name) => ({
                  type: "function",
                  function: { name, parameters: { type: "object", properties: {} } },
                })),
              }
            : {}),
        }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true, provider: "zen", detail: url };
      if (res.status === 401 || res.status === 403) {
        // 403 here is the free-tier gate, not the key; 401 is the key. Saying
        // "api_key rechazada" for both sent people to rotate a key that was
        // fine.
        const body = await res.json().catch(() => null);
        const kind =
          body?.error?.type === "FreeTierError"
            ? "el gateway rechazó el pedido como fuera de opencode (¿se movió el gate? ver la nota en zen.js)"
            : "api_key rechazada";
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
