---
name: apx-routine
description: Create, edit, run, debug APX routines (scheduled tasks). Load BEFORE `apx routine add` — schedule grammar, kind selection, pre/post hooks, double-reply gotcha.
---

# apx-routine

A scheduled APX task. Scheduler ticks every 5s. Each routine has a `kind`, `schedule`, optional `spec`, and optional `pre_commands` / `post_commands` shell hooks.

## Picking `kind`

| Kind | Tools? | Description |
|---|---|---|
| `heartbeat` | no | "Still alive" marker. No LLM. |
| `shell` | no | Pure shell. Stdout captured. |
| `exec_agent` | **agent allowlist** | Loads that project agent and runs `spec.prompt`. By default the agent uses its own resolved tools (its `tools:` field, or the broad capability default when it declares none). Persists a conversation. A **non-empty** routine `allowed_tools` overrides the card. For the one-shot text path (no tools at all), set `spec.no_tools: true` — see the gotcha below. |
| `watch` | **agent allowlist** | Deterministic detection first, then a model judgement step over `spec.prompt`. A watcher, not a cron+LLM. Needs `spec.prompt`. |
| `super_agent` | **all** | Default agent with full tool registry. Multi-iteration loop. |
| `telegram` | n/a | Sends hardcoded text via Telegram plugin. `spec.text` is the message body — the automation header is NOT prepended to it. |

Rule: a project agent that must *do* work (read files, Asana, compact a ledger) → `exec_agent`; orchestration as the super-agent → `super_agent`; text-only + shell delivery → `exec_agent` with `spec.no_tools: true`; pure shell → `shell`; fixed Telegram poke → `telegram`.

### `allowed_tools` vs `no_tools` (read before you copy a skeleton)

- `allowed_tools` **non-empty** → overrides the agent's card for this routine.
- `allowed_tools: []` → **no override; the agent runs with its OWN resolved tools.** This is NOT "no tools" — and `[]` is exactly what `apx routine add` writes when you pass no `--allowed-tools`, so an ordinary create already gives the agent its tools.
- `spec.no_tools: true` → the deliberate opt-out: a single text-only call, no tools, for the "write one sentence, `post_commands` deliver it" pattern.

## Schedule grammar

- `every:<N><unit>` — `every:30s`, `every:5m`, `every:24h`, `every:7d`. **Most common.**
- `once:<iso-8601>` — `once:2026-12-01T08:00:00Z`. Fires once, then disabled.
- Cron — `*/5 * * * *`, `0 8 * * *`. Standard 5-field.

## Anatomy

```json
{
  "name": "weather-bariloche",
  "kind": "exec_agent",
  "schedule": "every:24h",
  "spec": { "agent": "default", "prompt": "Write a short greeting..." },
  "pre_commands":  ["curl -s 'https://wttr.in/Bariloche?format=...'"],
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""],
  "enabled": true,
  "skip_prompt_on": "signal"
}
```

Pipeline: `pre_commands` run sequentially → combined stdout becomes `{{pre_output}}` in `spec.prompt` / `spec.text` and `$APX_PRE_OUTPUT` (plus `$APX_PRE_OUTPUT_FILE` for big payloads) → handler runs, result becomes `$APX_LLM_OUTPUT` → `post_commands` run. `{{pre_output}}` is always substituted — with no pre_commands it renders empty, never as literal braces.

## Automation header (native — don't hand-roll the date)

The runner prepends a native **automation header** to the top of `spec.prompt` on every LLM-backed run (`core/routines/header.js`, built in `core/routines/runner.js`). It carries: routine name + id, the routine's memory path, `last_run_at` and this run's start — each clock given twice, machine-friendly (ISO + epoch ms, UTC) and human-friendly in the owner's `config.user.timezone` / `.locale`.

This **replaces the old `echo "…date…"` pre_command + `{{pre_output}}` trick** for "what time / day is it". Do NOT add a shell pre_command just to feed the model the date — it already opens on who it is and what "now" is. The header is NOT prepended to a `telegram` routine's `spec.text` (that string is the message body, sent verbatim).

## Iteration budget

- A routine that **reports to Telegram** (its `post_commands` send via Telegram, so `send_telegram` is auto-suppressed) uses `super_agent.telegram_max_iters` (default `TELEGRAM_TOOL_ITERS`, a high runaway backstop) and normally runs until work is done.
- Any **other** routine runs effectively **uncapped** to completion (`super_agent.routine_max_iters`, default `ROUTINE_UNCAPPED_TOOL_ITERS`): background work nobody is watching (Magui filling a backlog) must finish, not get cut at the chat budget. Only the `post_command` Telegram sink marks a routine telegram-bound — a routine whose *agent* sends a summary at the end is still uncapped.

## Anti-example: double-reply

```json
{
  "kind": "super_agent",   ← DON'T
  "spec": { "prompt": "The weather is {{pre_output}}. Send it via Telegram." },
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""]
}
```

Sends **two** messages: one from agent's `send_telegram` tool, one from `post_commands`. The runner auto-suppresses `send_telegram` when post contains `apx telegram send`, but the clean fix is `exec_agent` with tools off (`spec.no_tools: true` — NOT `allowed_tools: []`, which leaves the agent's tools on):

```json
{
  "kind": "exec_agent",
  "spec": { "agent": "default", "no_tools": true, "prompt": "The weather is {{pre_output}}. One friendly sentence." },
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""]
}
```

## Concrete CLI calls

```bash
# Always pin --project; never use default for real ones
apx routine list --project acme
apx routine get  weather-bariloche --project acme

# Create — exec_agent + shell delivery
apx routine add weather-bariloche \
  --project acme \
  --kind exec_agent \
  --schedule "every:24h" \
  --spec '{"agent":"default","prompt":"The weather is {{pre_output}}. One friendly sentence."}' \
  --pre-commands "curl -s 'https://wttr.in/Bariloche?format=%t+%C+viento+%w'" \
  --post-commands 'apx telegram send "$APX_LLM_OUTPUT"'

# Create — super-agent with tools
apx routine add daily-status \
  --project acme \
  --kind super_agent \
  --schedule "0 9 * * *" \
  --spec '{"prompt":"List projects with pending tasks and send me a short summary via Telegram."}' \
  --permission-mode automatico

# Toggle / run / remove
apx routine enable  weather-bariloche --project acme
apx routine disable weather-bariloche --project acme
apx routine run     weather-bariloche --project acme     # force-trigger now
apx routine remove  weather-bariloche --project acme
```

## `--project` is non-negotiable

Routines live in `~/.apx/projects/<apxId>/routines.json`. Without `--project`, they go to default (id=0, super-agent scratch) — **not** a user project. Always pass `--project <name|id|path>`.

## `skip_prompt_on`

Gates the LLM call based on `pre_commands` (`shouldSkipPrompt` in `src/core/routines/runner.js`). Post-commands always run.

| Value | Skips LLM when… |
|---|---|
| `signal` (default) | pre_command prints literal `APX_SKIP`. Non-zero exit alone does NOT skip. |
| `pre_failure` | any pre_command exits non-zero. |
| `pre_success` | pre_commands exit 0 (LLM only on pre failure). |
| `always` | unconditionally — pure pre→post, no LLM. |
| `never` | LLM always runs, even if pre crashes. |

## Debugging

```bash
apx routine history weather-bariloche --project acme    # last runs
apx log -f                                                  # tail unified log
apx messages tail --channel routine -n 20                   # routine-channel messages

# Routine memory (the file named in the automation header)
apx routine memory show weather-bariloche --project acme    # read it
apx routine memory add  weather-bariloche "note" --project acme   # append a note
apx routine memory path weather-bariloche --project acme    # print its path
```

"Sends nothing" usually means: `enabled: false`, `next_run_at` in the future, or empty LLM text (check `apx messages` or `result.text`).

## Don't

- Use `super_agent` when a project agent should own the work — `exec_agent` runs that agent with tools and the chat lands under their name.
- Write `apx telegram send` inside a `super_agent` prompt — agent calls `send_telegram` AND post_commands fire. Pick one.
- Hardcode model names in `spec` without reason — routines inherit `super_agent.model` (with router fallback).
- Put credentials in `spec`. Use `~/.apx/config.json` engines and reference by provider.
