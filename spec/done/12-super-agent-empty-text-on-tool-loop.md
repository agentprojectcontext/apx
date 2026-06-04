# 12 — Super-agent returns empty text after tool iterations on some cloud models

**Priority**: P1
**Size**: M
**Status**: idea

## Problem

With `super_agent.model` set to `openrouter:meta-llama/llama-3.3-70b-instruct` or `groq:qwen/qwen3-32b`, calling the super-agent over `/projects/:pid/super-agent/chat` returns `text: ""` and an empty `trace` for simple prompts ("Decime hola").

Direct `callEngine()` calls to the same model — with and without tools — work fine:

- Without tools: returns text normally.
- With tools + `toolChoice: 'required'`: returns `text: ""` AND a structured `tool_calls` array (correct behavior — the model chose to call a tool instead of replying).

So the breakage is in the LOOP, not the engine. The iter-0 force-tool returns a structured call, the loop executes it, but the follow-up iterations either: (a) keep force-tool active and the model has nothing useful to call, (b) the model's iter-N response has empty text + no tools and the loop ends with `lastText = ""`.

Reproducible with:
```bash
curl -X POST http://127.0.0.1:7430/projects/0/super-agent/chat \
  -H "Authorization: Bearer $(cat ~/.apx/daemon.token)" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Decime hola","model":"openrouter:meta-llama/llama-3.3-70b-instruct"}'
# → {"text":"","trace":[]}  OR {"text":"","trace":[...repeated list_projects calls...]}
```

When the model is Anthropic (`claude-*`) the loop terminates correctly because Claude is well-trained on the tool-then-text pattern. The non-Anthropic providers above either loop or quit silent.

## Hypotheses

1. **`forceTool` policy is too aggressive**. `run-agent.js` sets `forceTool=true` on iter 0 and again on `ackOnlyStreak > 0`. For simple prompts that don't need a tool, this pushes models that aren't great at refusing into a useless call, then the post-tool iteration also goes wrong because the model expected closure.
2. **The `tools` array is too big**. 44 tools, ~22 KB of JSON schema. Some models de-prioritize text output when their context budget is consumed by schemas.
3. **`pseudoToolSystem` fallback isn't kicking in**. The fallback is gated on Ollama 500s; OpenRouter / Groq failures fall through differently.

## Investigation plan

- Add an `apx debug super-agent --model X --prompt Y` mode that dumps the full iter-by-iter request/response.
- Log per-iter result.text, finish_reason, tool_calls.length so we can see exactly when text goes empty.
- For (1): try `toolChoice: "auto"` from iter 0 unless the user message *clearly* implies action (`isActionRequest()` already exists). Otherwise let the model just talk.
- For (2): subset the registry per-channel (Telegram doesn't need `transcribe_audio`; CLI doesn't need `send_telegram`).

## Workarounds today

- Keep `super_agent.model` on Anthropic when an API key is available.
- For chat without tools (`apx exec super-agent "hi"` analog), the issue may be acceptable.
- When Ollama isn't responding, the fallback chain produces empty replies — DON'T mark Ollama healthy unless the configured model is actually loaded (this is what backlog item 11 is about).

## Done criteria

- [ ] `apx exec super-agent "decime hola"` (or `/super-agent/chat` with that prompt) returns a non-empty text reply with **any** configured model that has tools support.
- [ ] Loop emits a debug event per iter (`type: "iter_end", text_len, tool_count, finish_reason`) so this is diagnosable.
- [ ] Documented in `apx-routine` skill / per-engine notes which models are known-good for the super-agent loop.

## Owner

Unassigned. Diagnostic depth + per-model regression suite. Estimate 2-3 hours once we have the per-iter logs.
