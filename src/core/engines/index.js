// Engine adapter registry. Maps a model id → provider → adapter.
//
// Model id grammar (in agents.<slug>.model):
//   "<provider>:<model>"   explicit, e.g. "ollama:llama3.2", "anthropic:claude-haiku-4-5"
//   "<model>"              inferred: claude-* → anthropic, gpt-* → openai, gemini-* → gemini
//
// Each adapter exports a default object:
//   { id, chat({system, messages, model, temperature, maxTokens}) → {text, usage, raw} }
//
// API keys come from ~/.apx/config.json `engines.<provider>.api_key` or env vars
// (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).
// Ollama needs no key, just a base_url (default http://localhost:11434).

import { recordLlmCall } from "#core/stores/llm-usage.js";
import anthropic from "./anthropic.js";
import openai from "./openai.js";
import groq from "./groq.js";
import openrouter from "./openrouter.js";
import ollama from "./ollama.js";
import gemini from "./gemini.js";
import cerebras from "./cerebras.js";
import zen from "./zen.js";
import codexPlus from "./codex-plus.js";
import claudeSubscription from "./claude-subscription.js";
import mock from "./mock.js";

const ADAPTERS = {
  anthropic,
  openai,
  groq,
  openrouter,
  cerebras,
  ollama,
  gemini,
  zen,
  "codex-plus": codexPlus,
  "claude-subscription": claudeSubscription,
  mock,
};

export function resolveProvider(modelId) {
  if (typeof modelId !== "string" || !modelId) {
    throw new Error("model id is empty");
  }
  if (modelId.includes(":")) {
    const [provider, ...rest] = modelId.split(":");
    return { provider: provider.toLowerCase(), model: rest.join(":") };
  }
  if (/^claude/i.test(modelId)) return { provider: "anthropic", model: modelId };
  if (/^gpt|^o1|^o3|^o4/i.test(modelId)) return { provider: "openai", model: modelId };
  if (/^gemini/i.test(modelId)) return { provider: "gemini", model: modelId };
  if (modelId === "mock") return { provider: "mock", model: "mock" };
  throw new Error(
    `cannot infer provider for model "${modelId}" — use explicit "<provider>:<model>" form`
  );
}

/**
 * The adapter behind a provider *slug*. A slug is not always an adapter id:
 * a provider named "carlos" running on Ollama is stored as
 * `engines.carlos = { engine: "ollama", … }`, and "carlos:llama3.2" has to
 * reach the ollama adapter. Falls back to the slug itself, which is the case
 * for the stock providers whose slug already is the engine id.
 */
export function adapterForSlug(slug, config) {
  const cfg = (config && config.engines && config.engines[slug]) || {};
  return getAdapter(cfg.engine || slug);
}

export function getAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) {
    throw new Error(
      `unknown engine provider "${provider}". Known: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }
  return a;
}

export async function callEngine({ modelId, system, messages, config, temperature, maxTokens, tools, toolChoice, signal, onToken, onReasoningToken, attribution = null }) {
  const { provider, model } = resolveProvider(modelId);
  const providerCfg = (config && config.engines && config.engines[provider]) || {};
  // `provider` here is the slug the user configured, which only coincides with
  // the adapter id for the stock providers.
  const adapter = getAdapter(providerCfg.engine || provider);
  // The per-provider `default_max_tokens` set in the web admin (Provider modal
  // slider) acts as a floor: callers may ask for more, but never less. This
  // matters for "thinking" models (e.g. Gemini 3.x) whose internal reasoning
  // tokens count against maxOutputTokens — too low a cap and the visible reply
  // gets truncated mid-sentence. Fallback chain:
  //   caller value → provider cfg → 2048 (safe baseline that survives thinking
  //   models without truncating; non-thinking models just don't fill it).
  const providerCap = Number(providerCfg.default_max_tokens) || 0;
  const callerCap = Number(maxTokens) || 0;
  const effectiveMaxTokens = Math.max(callerCap, providerCap) || 2048;
  // Every call is recorded — success or failure — so "what spent this
  // account" has an answer (core/stores/llm-usage.js). `attribution` is the
  // caller's {channel, agent, project}, when it knows them.
  const started = Date.now();
  // `mock` is the test engine: recording it would fill a developer's real
  // usage log with fake calls from any test run without an APX_HOME sandbox.
  const record = (row) => { if (adapter.id !== "mock") recordLlmCall({ modelId, ...row, attribution }); };

  // A call that goes quiet is cut here, the same way for every provider. Before
  // this the only limit was Node's own 300 s wait for response headers, and it
  // surfaced as a bare "fetch failed" nobody could read and the chain did not
  // rotate on: a local model given a 15k-token prompt with tools (no streaming)
  // held a routine — and the queue behind it — for five minutes, then failed.
  // The clock restarts on every streamed token, so a long answer that is
  // arriving is never cut; only silence is.
  const timeoutMs = engineTimeoutMs(config, provider);
  const ctrl = new AbortController();
  let timedOut = false;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  };
  const onCallerAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener?.("abort", onCallerAbort, { once: true });
  const progress = (fn) => (typeof fn === "function" ? (...args) => { arm(); return fn(...args); } : fn);
  arm();
  try {
    const out = await adapter.chat({
      system,
      messages,
      model,
      temperature,
      maxTokens: effectiveMaxTokens,
      tools,
      toolChoice,
      config: providerCfg,
      signal: ctrl.signal,
      onToken: progress(onToken),
      onReasoningToken: progress(onReasoningToken),
    });
    record({ ms: Date.now() - started, ok: true, usage: out?.usage });
    return out;
  } catch (e) {
    // Ours, not the caller's: say what happened and let the chain rotate.
    const err = timedOut && !signal?.aborted
      ? Object.assign(new Error(`${modelId}: no answer within ${Math.round(timeoutMs / 1000)} s`), {
          code: "ENGINE_TIMEOUT",
          retryable: true,
          cause: e,
        })
      : e;
    if (err?.name !== "AbortError") {
      record({ ms: Date.now() - started, ok: false, error: err?.message || err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onCallerAbort);
  }
}

/** Default silence budget for one engine call. Under Node's 300 s headers wait
 *  on purpose, so the clear error below fires before the opaque one. */
export const ENGINE_TIMEOUT_S = 180;

/**
 * How long one call to `provider` may go without a byte of answer:
 * `engines.<slug>.timeout_s` → `super_agent.engine_timeout_s` → ENGINE_TIMEOUT_S.
 * Per provider because "slow" is a property of where the model runs (a local
 * box, a busy gateway), not of APX.
 */
export function engineTimeoutMs(config, provider) {
  const pick = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const s = pick(config?.engines?.[provider]?.timeout_s)
    ?? pick(config?.super_agent?.engine_timeout_s)
    ?? ENGINE_TIMEOUT_S;
  return s * 1000;
}

export const ENGINE_IDS = Object.keys(ADAPTERS);
