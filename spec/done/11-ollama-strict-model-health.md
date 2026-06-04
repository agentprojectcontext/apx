# 11 — Ollama health check should verify the configured model exists

**Priority**: P1
**Size**: S
**Status**: idea

## Problem

`checkProviderHealth("ollama")` (in `src/core/agent/model-router.js`) pings `GET /api/tags`. If the host answers — even with an empty model list — the provider is reported healthy. The model router then chooses Ollama as the primary, the engine call later fails because the configured model (e.g. `gemma4:31b-cloud`) isn't actually present, and the super-agent returns empty text without ever falling back to OpenRouter or Groq.

Observed 2026-05-27: `super_agent.model = "ollama:gemma4:31b-cloud"` on a host where Ollama runs but doesn't have that model loaded. Result: every super-agent call returned `text: ""` until we manually flipped the primary to `openrouter:meta-llama/llama-3.3-70b-instruct`.

## Decision

Tighten the Ollama health check:

1. Hit `/api/tags`.
2. If a specific model is being evaluated (the primary), parse the `:<model>` tag from `super_agent.model` and confirm it's in the response's `models[].name` list (substring or exact, both acceptable).
3. If the model isn't there, return `{ ok: false, reason: "model not loaded", available: [<names>] }`.

The fallback chain then naturally rolls forward to OpenRouter / Groq without manual intervention.

For the auto-fallback's *secondary* providers, keep today's looser semantics — the order's existence is the contract; we don't need to verify every Ollama model when Ollama isn't primary.

## Files to touch

- `src/core/agent/model-router.js` — `checkProviderHealth("ollama", ...)` accepts the candidate model id, fetches `/api/tags`, validates membership.
- `src/core/agent/model-router.js` — `resolveActiveModel` passes the candidate model into the health check.
- `tests/model-router.test.js` (if it exists; else create) — case: tags returned but candidate not present → ok:false → fallback fires.

## Done criteria

- [ ] Setting `super_agent.model` to an Ollama model that isn't pulled, with Ollama up but model missing, causes the router to log `model_routed` with `from_fallback: true` on the next super-agent invocation.
- [ ] `apx status` (engines section) shows Ollama as `active` only when the primary model is also resolvable, otherwise "running but configured model missing".
- [ ] Test covers the failing case.

## Owner

Unassigned.
