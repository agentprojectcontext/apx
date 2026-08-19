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
| `exec_agent` | **agent allowlist** | Loads that project agent and runs `spec.prompt` with the agent's `tools:` field (not the super-agent registry). Persists a conversation. Routine `allowed_tools` overrides the card. `allowed_tools: []` or `spec.no_tools: true` keeps the old one-shot text path. |
| `super_agent` | **all** | Default agent with full tool registry. Multi-iteration loop. |
| `telegram` | n/a | Sends hardcoded text via Telegram plugin. |

Rule: a project agent that must *do* work (read files, Asana, compact a ledger) → `exec_agent`; orchestration as the super-agent → `super_agent`; text-only + shell delivery → `exec_agent` with `allowed_tools: []`; pure shell → `shell`; fixed Telegram poke → `telegram`.

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

## Anti-example: double-reply

```json
{
  "kind": "super_agent",   ← DON'T
  "spec": { "prompt": "The weather is {{pre_output}}. Send it via Telegram." },
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""]
}
```

Sends **two** messages: one from agent's `send_telegram` tool, one from `post_commands`. The runner auto-suppresses `send_telegram` when post contains `apx telegram send`, but the clean fix is `exec_agent` with no tools:

```json
{
  "kind": "exec_agent",
  "allowed_tools": [],
  "spec": { "agent": "default", "prompt": "The weather is {{pre_output}}. One friendly sentence." },
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

Gates the LLM call based on `pre_commands` (`shouldSkipPrompt` in `host/daemon/routines.js`). Post-commands always run.

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
```

"Sends nothing" usually means: `enabled: false`, `next_run_at` in the future, or empty LLM text (check `apx messages` or `result.text`).

## Don't

- Use `super_agent` when a project agent should own the work — `exec_agent` runs that agent with tools and the chat lands under their name.
- Write `apx telegram send` inside a `super_agent` prompt — agent calls `send_telegram` AND post_commands fire. Pick one.
- Hardcode model names in `spec` without reason — routines inherit `super_agent.model` (with router fallback).
- Put credentials in `spec`. Use `~/.apx/config.json` engines and reference by provider.
