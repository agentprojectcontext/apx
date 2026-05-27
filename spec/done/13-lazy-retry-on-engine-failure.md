# 13 — Lazy retry: advance the fallback chain when a healthy provider's call fails at runtime

**Priority**: P1
**Size**: M
**Status**: idea

## Problem

`checkProviderHealth()` is proactive but loose for cloud providers:

- **OpenRouter / Groq / OpenAI**: hits `/models`. A 200 OK means the catalog is reachable. It does NOT mean:
  - the specific model is callable (deprecated, gated, rate-limited),
  - the user's key has access to that model,
  - the model isn't behind a quota throttle that returns 429 on POST.
- **Anthropic / Gemini**: only checks for an api_key. No real health probe.

Observed today (2026-05-27): `resolveActiveModel` picked `openrouter:openrouter/free` from the fallback chain — health said "ok" — and the actual chat call returned `429 Provider returned error`. The super-agent ended with an empty reply because the loop has no recovery path for a healthy-but-failing call.

## Decision

Add a **lazy retry** layer in `runAgent` (or `resolveActiveModel`):

When `callEngine()` throws an error that looks transient or model-specific (429, 5xx, "model not found", "provider returned error"), advance the chain and re-invoke the engine with the next candidate. Use the same chain computed by `resolveActiveModel` — primary + `fallbackModels(globalConfig)`. Emit a progress event so the UI can show "switched to <model>".

Stop after the chain is exhausted; throw the last error.

## Constraints

- **Not all errors should retry**: a 401 (bad key) means the user's auth is wrong, not that the model is down. A 400 with our bad payload should be reported, not silently swapped. Build an allow-list of "retryable" error shapes.
- **Don't burn budget**: cap retries at the chain length. No exponential backoff within one chain — the next provider is presumed healthy by the proactive check; if it isn't, we keep moving.
- **Preserve the trace**: every attempt + outcome lands in the response trace so the user can see "tried groq → 429, fell to openrouter → ok".

## Files to touch

- `src/core/agent/run-agent.js` — wrap the iter-loop's `callEngine` call: on retryable error, ask the router for the next candidate and retry.
- `src/core/agent/model-router.js` — export a small helper `nextCandidateAfter(modelId, globalConfig)` that returns the next model in the chain after the given one.
- `src/host/daemon/api/super-agent.js` — surface the retry events in the NDJSON stream so clients can show them.
- `tests/lazy-retry.test.js` (new).

## Done criteria

- [ ] When the primary engine returns 429, the super-agent transparently switches to the next model in the chain and finishes the turn.
- [ ] Trace shows both attempts (`model_used: ollama:gemma4`, error→ then `model_used: groq:qwen3-32b`, ok).
- [ ] 401 / 400 / auth errors do NOT trigger retry; they surface as the user-facing error.
- [ ] Test covers transient retry + non-retryable bail-out.
- [ ] Doc note in `spec/decisions/` once we settle on the error allow-list.

## Owner

Unassigned. Estimate: 3-4 hours including test scaffolding.
