---
name: apx-routine
description: How to create, edit, run, and debug APX routines. Use BEFORE writing any `apx routine add` command — schedule grammar, kind selection, pre/post commands, and the gotchas that produce double-replies.
---

# apx-routine

A routine is a scheduled APX task. APX runs the scheduler tick every 5s and fires routines that are due. Each routine has a `kind`, a `schedule`, an optional `spec`, and optional `pre_commands` / `post_commands` shell hooks.

## When to use which `kind`

| Kind | Tools? | Description |
|---|---|---|
| `heartbeat` | no | Logs a marker message. Useful as a "still alive" ping. No LLM call. |
| `shell` | no | Pure shell command. No LLM. Stdout captured. |
| `exec_agent` | **no tools** | Loads a project agent's system prompt, sends `spec.prompt` to the engine, returns plain text. Single LLM call. |
| `super_agent` | **all tools** | Runs the APX default agent (super-agent mode) with the full tool registry. Multi-iteration tool loop. |
| `telegram` | n/a | Sends a hardcoded text via the Telegram plugin. |

**Picking rule of thumb**:
- Just need text from a model? → `exec_agent`.
- Need orchestration (call MCPs, write files, call other agents, send messages with logic)? → `super_agent`.
- Pure shell (curl + jq + write somewhere)? → `shell`.
- Periodic Telegram poke with fixed text? → `telegram`.

## Schedule grammar

- `every:<N><unit>` — `every:30s`, `every:5m`, `every:24h`, `every:7d`. **Most common.**
- `once:<iso-8601>` — `once:2026-12-01T08:00:00Z`. Fires once at that instant, then disabled.
- Cron — `*/5 * * * *`, `0 8 * * *`. Standard 5-field. Use only if you really need cron expressions.

## Anatomy of a routine

```json
{
  "name": "weather-bariloche",
  "kind": "exec_agent",
  "schedule": "every:24h",
  "spec": { "agent": "default", "prompt": "Escribí un saludo breve..." },
  "pre_commands":  ["curl -s 'https://wttr.in/Bariloche?format=...'"],
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""],
  "enabled": true,
  "skip_prompt_on": "signal"
}
```

**The pipeline**:
1. `pre_commands` run sequentially. Their combined stdout becomes `{{pre_output}}` substitutable in `spec.prompt`, and `$APX_PRE_OUTPUT` env var available to `post_commands`. Also written to `$APX_PRE_OUTPUT_FILE` for big payloads.
2. The handler for `kind` runs. Its text result is exposed to post hooks as `$APX_LLM_OUTPUT`.
3. `post_commands` run sequentially with that env.

## Anti-example: the double-reply

```json
{
  "kind": "super_agent",   ← DON'T
  "spec": { "prompt": "El clima es {{pre_output}}. Mandalo por Telegram." },
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""]
}
```

This sends **two** Telegram messages: one from the super-agent's `send_telegram` tool call, one from `post_commands`. The runner now auto-suppresses `send_telegram` when `post_commands` contains `apx telegram send` (see spec/done/01), but the cleaner fix is to use `exec_agent`:

```json
{
  "kind": "exec_agent",
  "spec": { "agent": "default", "prompt": "El clima es {{pre_output}}. Una frase amigable, sin saludos." },
  "post_commands": ["apx telegram send \"$APX_LLM_OUTPUT\""]
}
```

One message, the model writes prose, the shell pipes it to Telegram.

## Concrete CLI calls

```bash
# List routines per project (always pin --project; never use default for real ones)
apx routine list --project iacrmar

# Inspect one
apx routine get weather-bariloche --project iacrmar

# Create — text-only exec_agent + shell delivery
apx routine add weather-bariloche \
  --project iacrmar \
  --kind exec_agent \
  --schedule "every:24h" \
  --spec '{"agent":"default","prompt":"El clima es {{pre_output}}. Una frase amigable."}' \
  --pre-commands "curl -s 'https://wttr.in/Bariloche?format=%t+%C+viento+%w'" \
  --post-commands 'apx telegram send "$APX_LLM_OUTPUT"'

# Create — super-agent with tools
apx routine add daily-status \
  --project iacrmar \
  --kind super_agent \
  --schedule "0 9 * * *" \
  --spec '{"prompt":"Listame proyectos con tasks pendientes y mandame por Telegram un resumen corto."}' \
  --permission-mode automatico

# Toggle, run, remove
apx routine enable  weather-bariloche --project iacrmar
apx routine disable weather-bariloche --project iacrmar
apx routine run     weather-bariloche --project iacrmar     # force-trigger now
apx routine remove  weather-bariloche --project iacrmar
```

## `--project` is non-negotiable

Routines live in `~/.apx/projects/<apxId>/routines.json`. Without `--project`, the default project (id=0, the super-agent's scratch workspace) gets the routine — that is **not** a user project. Always pass `--project <name|id|path>`.

## `skip_prompt_on`

Controls what happens when `pre_commands` exit non-zero:

| Value | Behavior |
|---|---|
| `signal` (default) | Skip the LLM only on SIGINT/SIGTERM; non-zero exit still runs the LLM. |
| `pre_failure` | Skip LLM + post on any non-zero exit. |
| `pre_success` | Only run LLM if every pre command exits 0. Same as `pre_failure` for most cases. |
| `always` | Skip LLM unconditionally — useful when you want pure pre→post pipelines. |
| `never` | Always run, even if pre crashes. |

## Debugging a routine

```bash
apx routine history weather-bariloche --project iacrmar    # last runs
apx log -f                                                  # tail unified log
apx messages tail --channel routine -n 20                   # routine-channel messages
```

A routine that "sends nothing" most often means: (a) `enabled: false`, (b) `next_run_at` is in the future, (c) the LLM returned empty text — visible in `apx messages` or in the `result.text` of `apx routine run`.

## Don't

- Don't use `super_agent` when `exec_agent` would do. The super-agent loops, calls tools, costs more.
- Don't write `apx telegram send` inside a `super_agent` routine prompt — the agent will call `send_telegram` AND `post_commands` will fire. Pick one.
- Don't hardcode model names in `spec` unless you have a reason — the routine inherits `super_agent.model` (with router fallback) by default.
- Don't put credentials in routine `spec`. Put them in `~/.apx/config.json` engines and reference them by provider.
