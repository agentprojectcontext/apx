# 03 — Wizard: channel ↔ project ↔ master agent

**Priority**: P1
**Size**: M
**Status**: idea

## Problem

The channel-to-project link (`channels[].project`) and the per-channel master agent (`channels[].route_to_agent`) are already implemented in `src/host/daemon/plugins/telegram.js:297-314`, but there is no CLI or wizard to set them up. Users have to hand-edit `~/.apx/config.json`.

The desired flow:

> "I want the channel `clientes` to belong to project `iacrmar`, and incoming messages should be handled by agent `comercial` instead of the default APX agent. When messages arrive on that channel, APX should bootstrap a session in that project with that agent, no need for the user to say which project / agent."

## Desired UX

```bash
# Interactive wizard
apx telegram channel add
  > name: clientes
  > bot token: …
  > chat id: …
  > pin to project (optional): iacrmar         ← list registered projects, allow "none"
  > master agent for this channel (optional): comercial   ← list agents of the chosen project, allow "default APX"
  > respond with engine: [Y/n]
  > done.

# Inspect / edit later
apx telegram channel list
apx telegram channel show clientes
apx telegram channel set clientes --project iacrmar
apx telegram channel set clientes --agent comercial
apx telegram channel unset clientes --project
apx telegram channel remove clientes
```

Setup wizard (`apx setup`) should call into this when the user enables Telegram and offer to wire the default channel to a project.

## Behavior wiring (already in code, just expose)

- When a message arrives on a channel with `project: "iacrmar"`, the super-agent invocation gets `channelMeta.projectId` set to that project's id. The system prompt and tools resolve project-scoped (agents, MCPs, memory) for that turn.
- When `route_to_agent: "comercial"` is set, the channel routes through `/projects/:pid/agents/comercial/chat` instead of the super-agent endpoint.

## Files to touch

- `src/interfaces/cli/commands/telegram.js` — add `channel` subcommand tree (`add | list | show | set | unset | remove`).
- `src/interfaces/cli/commands/setup.js` — at the end of the telegram step, offer the project-pin and agent-route prompts.
- `src/host/daemon/api/telegram.js` — endpoints `/telegram/channels` (GET/POST/PATCH/DELETE) backing the CLI. The plugin already reads channels from config; the endpoints just edit `~/.apx/config.json` safely.
- `src/core/config.js` — small helper `upsertTelegramChannel(name, patch)` so wizard and API share the write path.
- `tests/telegram-channels.test.js` (new).

## Done criteria

- [ ] `apx telegram channel add` works interactively.
- [ ] Sending a message to a channel pinned to `iacrmar` with `route_to_agent: comercial` triggers a session in that project with that agent (verify with `apx messages tail --channel telegram`).
- [ ] Listing channels shows project pin + master agent.
- [ ] `apx setup` includes the new prompts; existing behavior unchanged for users who skip them.

## Owner

Agent B (paralelo).
