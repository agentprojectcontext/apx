# 01 — Routine output coherence (no double-reply)

**Priority**: P0
**Size**: S
**Status**: in-progress

## Problem

A `super_agent` routine that has `post_commands` ending in `apx telegram send "$APX_LLM_OUTPUT"` sends **two** Telegram messages instead of one:

1. The first message is the super-agent's `send_telegram` tool call inside the loop (with the actual content).
2. The second message is the final `text` of the loop ("Listo, ya te mandé el clima") piped through `post_commands` into telegram again.

Real example observed in the weather-bariloche routine:
```
Msg 1: "¡Hola Manú! En Bariloche hace frío: 0°C (sensación de -2°C)…"
Msg 2: "¡Listo, Manú! Ya te mandé el clima de Bariloche por Telegram."
```

## Root cause

`super_agent` kind loads the full tool registry, including `send_telegram`. The model decides to call it because it's available and the prompt mentions a Telegram delivery. Meanwhile, `post_commands` is also configured to send. Two output paths, one logical action.

## Solutions

### Immediate config workaround (no code)

Change routine `kind: super_agent` → `kind: exec_agent`. `exec_agent` has no tools, so the model returns plain text; `post_commands` sends it. Single message.

### Real fix (code, this item)

The runtime should detect "tools that will duplicate post-command outputs" and disable them for that routine run:

1. Add an optional field `routine.spec.suppress_tools: ["send_telegram", ...]` so power users can opt in explicitly.
2. Auto-detect: when `post_commands` contains a known output command (`apx telegram send`, `apx voice say`, etc.), suppress the corresponding tool from the registry passed to `runAgent` for that invocation only.
3. The suppression list is a small static map maintained in `core/agent/`:
   ```js
   const POSTCMD_TOOL_OVERLAP = {
     "apx telegram send": ["send_telegram"],
     "apx voice say":     ["say_voice"],         // when that tool exists
   };
   ```
4. Log when suppression fires so users know.

## Files to touch

- `src/host/daemon/routines.js` — when building the `super_agent` invocation, compute the suppress set from `post_commands` strings and pass to `runAgent`.
- `src/core/agent/run-agent.js` — accept `suppressTools: string[]` in opts, filter the tool list before calling the engine.
- `src/core/agent/index.js` — export the overlap map for tests.
- `tests/routines-suppress-tools.test.js` (new).

## Done criteria

- [ ] Running the existing weather-bariloche routine produces exactly one Telegram message.
- [ ] A unit test asserts that `runAgent({ tools, suppressTools: ['send_telegram'] })` filters the tool out.
- [ ] An integration test runs a fake `super_agent` routine with `post_commands` containing `apx telegram send` and checks suppression fires.
- [ ] Logs include a line like `[routine] suppressed tools due to post_commands: send_telegram`.

## Owner

Self (Opus).
