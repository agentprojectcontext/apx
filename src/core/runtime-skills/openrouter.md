---
name: openrouter
description: "Activate ONLY when the user explicitly mentions OpenRouter, OPENROUTER_API_KEY, OpenRouter models, installing OpenRouter provider config, or using OpenRouter with APX, OpenCode, LiteLLM, or an OpenAI-compatible client."
homepage: https://openrouter.ai/docs
---
# OpenRouter

Use this skill only for OpenRouter install/config, model listing, or usage through APX/OpenCode or
OpenAI-compatible clients.

## Verify before acting

OpenRouter is an API/provider, not a local coding runtime by itself. First identify which client
will use it: APX engine, OpenCode provider, LiteLLM, OpenAI SDK, or another OpenAI-compatible tool.

Do not expose keys. Check only presence:

```bash
test -n "$OPENROUTER_API_KEY" && echo "OPENROUTER_API_KEY present"
```

## OpenAI-compatible base URL

Typical API settings:

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=...
```

Use the selected client's current docs/help before writing config.

## APX guidance

If configuring APX engine/provider, inspect current config schema first:

```bash
apx config --help
apx status
```

Then update only non-secret project-safe settings. Keep API keys in user config or environment, not
in `.apc/` or git.

## OpenCode guidance

If using OpenRouter via OpenCode, inspect provider commands first:

```bash
opencode providers
opencode models
```

Then configure OpenRouter through OpenCode's current provider flow.
