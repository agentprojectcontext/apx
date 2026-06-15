// Engine-error classification: which failures advance the fallback chain vs
// surface to the user, plus when an Ollama tool failure should retry with
// text-based pseudo-tools. Regression guard for the Telegram incident where a
// Gemini rate-limit fell back to ollama:gemma*-cloud, which 400'd on tool
// grammar and killed the chain instead of advancing to a tool-capable model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableEngineError } from "#core/agent/retry.js";
import { shouldRetryWithPseudoTools } from "#core/agent/tools/pseudo-tools.js";

const OLLAMA_GRAMMAR_400 = `ollama 400: {"error":"Value looks like object, but can't find closing '}' symbol"}`;

test("isRetryableEngineError: ollama tool-grammar 400 advances the chain", () => {
  assert.equal(isRetryableEngineError(new Error(OLLAMA_GRAMMAR_400)), true);
});

test("isRetryableEngineError: groq schema 400 stays fatal (our payload bug)", () => {
  assert.equal(
    isRetryableEngineError(new Error("groq 400: tools.0.function.parameters invalid schema")),
    false,
  );
});

test("isRetryableEngineError: 'failed to call a function' 400 retries (model quality)", () => {
  assert.equal(
    isRetryableEngineError(new Error("groq 400: Failed to call a function. Please adjust your prompt.")),
    true,
  );
});

test("isRetryableEngineError: auth 401 stays fatal", () => {
  assert.equal(isRetryableEngineError(new Error("openai 401: invalid api key")), false);
});

test("isRetryableEngineError: rate-limit 429 is retryable", () => {
  assert.equal(isRetryableEngineError(new Error("gemini 429: rate limit exceeded")), true);
});

test("shouldRetryWithPseudoTools: ollama tool-grammar 400 → pseudo-tools, scoped to ollama", () => {
  const err = new Error(OLLAMA_GRAMMAR_400);
  assert.equal(shouldRetryWithPseudoTools("ollama:gemma4:31b-cloud", err, false), true);
  // Not for non-ollama providers…
  assert.equal(shouldRetryWithPseudoTools("groq:llama-3.3-70b-versatile", err, false), false);
  // …and never once we're already in pseudo mode (avoid loops).
  assert.equal(shouldRetryWithPseudoTools("ollama:gemma4:31b-cloud", err, true), false);
});

test("shouldRetryWithPseudoTools: ollama 5xx still triggers pseudo-tools", () => {
  assert.equal(shouldRetryWithPseudoTools("ollama:x", new Error("ollama 500: model timeout"), false), true);
  assert.equal(shouldRetryWithPseudoTools("ollama:x", new Error("ollama 503: unavailable"), false), true);
});

test("shouldRetryWithPseudoTools: a plain ollama 400 (non-grammar) does NOT pseudo-retry", () => {
  assert.equal(
    shouldRetryWithPseudoTools("ollama:x", new Error("ollama 400: missing required field"), false),
    false,
  );
});
