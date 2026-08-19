// Google Gemini adapter (https://ai.google.dev/api/generate-content).
// Direct fetch, no SDK. Supports function calling (Gemini's name for tool
// use) so it can drive the super-agent loop on parity with Groq / OpenAI.
import { randomUUID } from "node:crypto";
import { matchesModelGlob, modelListFromConfig } from "./_globs.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getKey(config) {
  return getKeys(config)[0] || "";
}

/**
 * Every key we may use, in order.
 *
 * WHY THIS IS A LIST. Gemini's free tier meters per KEY per MODEL per DAY, and
 * the good models are metered tightly — 20 requests a day on gemini-3.5-flash.
 * One key runs out mid-morning and the whole chain collapses to whatever is
 * last, which in practice was a free OpenRouter router that answers with its
 * raw chain of thought. Several keys against the same tier multiply the day's
 * capacity by the number of keys, with no change in behaviour until one is
 * exhausted.
 *
 * `api_key` stays the primary so nothing about the existing single-key config
 * changes; `api_keys` is additive.
 */
export function getKeys(config = {}) {
  const raw = [
    config.api_key,
    ...(Array.isArray(config.api_keys) ? config.api_keys : []),
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ];
  const seen = new Set();
  const out = [];
  for (const k of raw) {
    const key = String(k || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Keys known to be out of quota for a given model, until the daily reset.
 *
 * In memory on purpose: quotas reset on Google's clock, not ours, and a
 * persisted "this key is dead" file would outlive the reset and permanently
 * shrink the pool. Losing this on restart costs one wasted request per key.
 */
const exhausted = new Map(); // `${model}\u0000${key}` -> epoch ms when it expires

function cooldownKey(model, key) {
  return `${model}\u0000${key}`;
}

function isExhausted(model, key, now = Date.now()) {
  const until = exhausted.get(cooldownKey(model, key));
  if (!until) return false;
  if (until <= now) {
    exhausted.delete(cooldownKey(model, key));
    return false;
  }
  return true;
}

/** Park a key until the next UTC midnight, which is when Google's RPD resets. */
function markExhausted(model, key, now = Date.now()) {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  exhausted.set(cooldownKey(model, key), reset.getTime());
}

/** Did this response mean "this key has no quota left", as opposed to a real error? */
function isQuotaError(status, json) {
  if (status === 429) return true;
  const msg = String(json?.error?.message || "");
  const reason = String(json?.error?.status || "");
  return reason === "RESOURCE_EXHAUSTED" || /quota|rate limit/i.test(msg);
}

/** Test-only: forget which keys are parked. */
export function _resetKeyCooldowns() {
  exhausted.clear();
}

// Convert OpenAI-style tool schemas (`{ type: "function", function: { name,
// description, parameters } }`) into Gemini's `functionDeclarations` shape.
function toGeminiTools(toolSchemas) {
  if (!Array.isArray(toolSchemas) || toolSchemas.length === 0) return undefined;
  return [
    {
      functionDeclarations: toolSchemas
        .map((t) => t.function || t)
        .filter((fn) => fn?.name)
        .map((fn) => ({
          name: fn.name,
          description: fn.description || "",
          parameters: fn.parameters || { type: "object", properties: {} },
        })),
    },
  ];
}

function signatureOf(part) {
  return part?.thoughtSignature || part?.thought_signature || null;
}

function callSignatureOf(tc) {
  return tc?._thoughtSignature || tc?.thought_signature || null;
}

function isFunctionCallPart(p) {
  return !!(p?.functionCall || p?.function_call);
}

// A raw part is replayable if it still holds content. Empty objects would be
// rejected by the API, and we never invent parts we didn't receive.
function isUsablePart(p) {
  return !!p && typeof p === "object" && Object.keys(p).length > 0;
}

function callArgsOf(tc) {
  const raw =
    typeof tc.function?.arguments === "string"
      ? safeParseJson(tc.function.arguments)
      : tc.function?.arguments || tc.arguments || {};
  return raw && typeof raw === "object" ? raw : {};
}

// Which models stamp a thoughtSignature on their own turns — and therefore
// demand it back on every functionCall part we replay. Declarative on purpose:
// covering a new family is one glob in this list, never a new branch in the
// code below.
//
// Patterns are shell-style globs matched against the bare model id (no
// provider prefix): `*` is any run of characters, `?` a single one.
// Verified live, one tool call per model — all return the signature:
//   gemini-2.5-flash, gemini-3-flash-preview, gemini-3.1-flash-lite,
//   gemini-3.6-flash. (gemini-2.0-* is retired by Google and never signed.)
//
// The 4.x/5.x entries are a forward default: the mechanism is a family trait,
// not a per-version quirk, so a new release is covered the day it ships.
// Anything still unlisted — a tuned endpoint, a family we didn't predict — is
// picked up at runtime by the evidence check in signaturesRequired().
export const THOUGHT_SIGNATURE_MODELS = [
  "gemini-2.5*",
  "gemini-3*",
  "gemini-4*",
  "gemini-5*",
];

// Per-install override, no code change required:
//   engines.gemini.thought_signature_models: ["gemini-3*", "my-tuned-model*"]
export function modelUsesThoughtSignatures(model, config = {}) {
  return matchesModelGlob(
    model,
    modelListFromConfig(config?.thought_signature_models, THOUGHT_SIGNATURE_MODELS)
  );
}

function historyHasSignature(messages) {
  for (const m of messages) {
    if (Array.isArray(m?._geminiRawParts) && m._geminiRawParts.some(signatureOf)) return true;
    if (Array.isArray(m?.tool_calls) && m.tool_calls.some(callSignatureOf)) return true;
  }
  return false;
}

function signaturesRequired(model, messages, config) {
  if (modelUsesThoughtSignatures(model, config)) return true;
  // Evidence beats the list: a model nobody declared, but which signed
  // something earlier in THIS conversation, gets the same treatment.
  return historyHasSignature(messages);
}

// Map our message history into Gemini's `contents` array. Tool results land as
// `functionResponse` parts on a `role: "user"` turn. Function calls emitted by
// the model in earlier turns become `functionCall` parts under `role: "model"`.
//
// Thinking-model history fidelity: when APX stores a Gemini-originated
// assistant turn it attaches `_geminiRawParts` — the verbatim `parts` array
// from the API response. We replay those raw parts here instead of
// reconstructing from `tool_calls`, which would lose the thought parts (and
// their thoughtSignature) that the signing families require in every
// subsequent turn. Falling back to reconstruction handles messages that came
// from a non-Gemini engine or were serialised before this field was added.
function toGeminiContents(messages, { model = "", config = {} } = {}) {
  const requireSignatures = signaturesRequired(model, messages, config);
  const out = [];
  // tool_call ids whose functionCall part we could not replay with a valid
  // signature and had to narrate as text instead. Their tool results must be
  // degraded to text too: Gemini rejects a functionResponse that answers a
  // call it can no longer see in the history.
  const degraded = new Set();

  for (const m of messages) {
    if (m.role === "tool") {
      const name = m.name || m.tool_name || "tool";
      const id = m.tool_call_id || m.id;
      if (id && degraded.has(id)) {
        // The call this answers was dropped, so it cannot be a functionResponse
        // (Gemini rejects a response to a call it cannot see). Carry the result
        // as an observation on the user side. Phrased as a plain report, never
        // as call syntax — anything that looks like a callable format in the
        // history gets imitated instead of executed.
        out.push({
          role: "user",
          parts: [{ text: `Resultado de ${name}: ${asText(m.content)}` }],
        });
        continue;
      }
      // Tool results ride under role "user", NOT "function": the newer models
      // (3.6/3.7) reject `role: "function"` outright —
      //   400 Role 'function' is not supported. Please use a valid role: …
      // — while every version accepts a user turn carrying functionResponse
      // parts. Parallel results merge into a single turn, mirroring the one
      // model turn that emitted the calls.
      const part = { functionResponse: { name, response: { content: m.content } } };
      const prev = out[out.length - 1];
      if (prev && prev.role === "user" && prev.parts.every((p) => p.functionResponse)) {
        prev.parts.push(part);
      } else {
        out.push({ role: "user", parts: [part] });
      }
      continue;
    }

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // Preferred path: replay the raw parts as Gemini returned them. This
      // preserves thought parts and their thoughtSignatures verbatim — the
      // signature belongs to the PART, and rebuilding loses whichever part
      // was carrying it.
      const raw = Array.isArray(m._geminiRawParts) ? m._geminiRawParts.filter(isUsablePart) : null;
      if (
        raw &&
        raw.length > 0 &&
        raw.some(isFunctionCallPart) &&
        (!requireSignatures || raw.some(signatureOf))
      ) {
        out.push({ role: "model", parts: raw });
        continue;
      }

      // Fallback: rebuild from tool_calls. Used for calls that never came from
      // a Gemini response — pseudo-tool calls parsed out of plain text, or a
      // turn inherited from another engine after a retry-chain model switch.
      //
      // The signature is per TURN, not per call: on parallel calls Gemini
      // stamps only the first part and accepts the siblings bare. So one
      // signature anywhere in the turn is enough to send it as real calls; a
      // turn with none at all is what earns the 400.
      const turnHasSignature = m.tool_calls.some(callSignatureOf);
      const parts = [];
      const text = typeof m.content === "string" ? m.content.trim() : "";
      if (text) parts.push({ text });
      for (const tc of m.tool_calls) {
        const name = tc.function?.name || tc.name;
        const sig = callSignatureOf(tc);
        if (requireSignatures && !turnHasSignature) {
          // Nothing to replay: sending this as a functionCall is a guaranteed
          // 400. DROP the call from the model turn — never transcribe it into
          // text. A model turn that reads "[tool call: run_shell] {...}" is a
          // worked example of writing calls as prose, and the model copies it:
          // it stops emitting functionCall parts, the loop sees no tool_calls,
          // and the transcript is delivered to the user as the final answer.
          // The call itself is not what the model needs to continue — the
          // RESULT is, and that still arrives (see the tool branch above).
          if (tc.id) degraded.add(tc.id);
          continue;
        }
        const part = { functionCall: { name, args: callArgsOf(tc) } };
        if (sig) part.thoughtSignature = sig;
        parts.push(part);
      }
      // Every call was dropped and the turn said nothing else: emit no turn at
      // all rather than an empty model message.
      if (parts.length === 0) continue;
      out.push({ role: "model", parts });
      continue;
    }

    // A plain turn. A user turn may carry images (Telegram photos, etc.);
    // Gemini takes them as inlineData parts beside the text. Non-multimodal
    // engines ignore the field entirely, so carrying it costs them nothing.
    const parts = [{ text: asText(m.content) }];
    if (m.role !== "assistant" && Array.isArray(m.images)) {
      for (const img of m.images) {
        if (!img?.data || !img?.mime) continue;
        parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
      }
    }
    out.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return out;
}

function asText(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export default {
  id: "gemini",
  needsApiKey: true,
  apiKeyEnv: "GEMINI_API_KEY",
  defaultFallbackModel: "gemini:gemini-2.5-flash",

  async health(config = {}) {
    const key = getKey(config);
    return key
      ? { ok: true, provider: "gemini", soft: true }
      : { ok: false, provider: "gemini", reason: "no api_key" };
  },

  async chat({
    system,
    messages,
    model,
    temperature = 0.7,
    maxTokens = 1024,
    tools,
    toolChoice,
    config = {},
    signal,
  }) {
    const keys = getKeys(config);
    if (!keys.length) throw new Error("gemini: no api_key (set GEMINI_API_KEY or engines.gemini.api_key)");
    if (!model) throw new Error("gemini: model required");

    const body = {
      contents: toGeminiContents(messages, { model, config }),
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const fnTools = toGeminiTools(tools);
    if (fnTools) {
      body.tools = fnTools;
      // Gemini's toolConfig.functionCallingConfig.mode:
      //   AUTO (default), ANY (force a call), NONE (text only).
      if (toolChoice === "required" || toolChoice === "any") {
        body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      } else if (toolChoice === "none") {
        body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      }
    }

    // Try each key in turn, skipping any already known to be out of quota for
    // THIS model today. A key exhausted on gemini-3.5-flash usually still has
    // its full allowance on the -lite tiers, so the cooldown is per model.
    const fresh = keys.filter((k) => !isExhausted(model, k));
    // All parked? Try them anyway rather than failing without asking — the
    // cooldown is a guess about Google's clock, and being wrong should cost a
    // request, not the turn.
    const order = fresh.length ? fresh : keys;

    let json;
    let lastError = null;
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const payload = await res.json();

      if (res.ok) { json = payload; break; }

      if (isQuotaError(res.status, payload)) {
        markExhausted(model, key);
        lastError = new Error(
          `gemini ${res.status}: ${payload?.error?.message || "quota exhausted"}`
        );
        continue; // next key
      }

      // A real error — a bad request, a missing model, a revoked key. Rotating
      // would just repeat it against every key and turn one clear failure into
      // N slow ones.
      throw new Error(
        `gemini ${res.status}: ${payload?.error?.message || JSON.stringify(payload)}`
      );
    }

    if (!json) {
      throw lastError || new Error("gemini: every key is out of quota for this model");
    }

    const parts = json.candidates?.[0]?.content?.parts || [];

    // Thinking models (gemini-2.5-flash, gemini-2.5-pro, etc.) emit thought
    // parts (p.thought === true) that must NOT be shown to the user — they are
    // internal reasoning. Only non-thought text parts form the visible reply.
    const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");

    // Extract function calls and translate them into the OpenAI-shaped
    // tool_calls the run-agent loop expects.
    //
    // KEY FIX: On thinking models the thoughtSignature lives on the THOUGHT
    // text part (p.thought === true), NOT on the functionCall part. We track
    // the most recently seen signature as we walk the parts array, so the
    // functionCall that follows a thought part picks it up correctly.
    // Signatures that appear directly on a functionCall part are also captured
    // (some non-thinking Gemini variants may do this).
    const toolCalls = [];
    let pendingThoughtSig = null;
    for (const p of parts) {
      // Collect thoughtSignature from wherever Gemini puts it: thought parts
      // or (less commonly) directly on the functionCall part.
      const partSig = p.thoughtSignature || p.thought_signature;
      if (partSig) pendingThoughtSig = partSig;

      const fc = p.functionCall || p.function_call;
      if (fc?.name) {
        const tc = {
          id: `gemini_${randomUUID().slice(0, 8)}`,
          type: "function",
          function: {
            name: fc.name,
            arguments: typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args || {}),
          },
        };
        // Attach the signature we collected above. On the next request
        // toGeminiContents() puts it back on the part so Gemini 2.5+ doesn't
        // reject the turn with 400 "missing thought_signature".
        if (pendingThoughtSig) {
          tc._thoughtSignature = pendingThoughtSig;
          pendingThoughtSig = null; // consumed; reset for potential next call
        }
        toolCalls.push(tc);
      }
    }

    return {
      text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      // Raw parts stored so toGeminiContents() can replay the model turn
      // faithfully (thought parts + functionCalls) on the next request.
      // This is the most robust way to satisfy Gemini's thought-signature
      // requirement without any reconstruction logic.
      _geminiRawParts: parts.length > 0 ? parts : undefined,
      finish_reason: json.candidates?.[0]?.finishReason || null,
      usage: {
        input_tokens: json.usageMetadata?.promptTokenCount || 0,
        output_tokens: json.usageMetadata?.candidatesTokenCount || 0,
      },
      raw: json,
    };
  },
};
