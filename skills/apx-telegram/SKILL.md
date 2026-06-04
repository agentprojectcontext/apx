---
name: apx-telegram
description: How APX talks to Telegram — channels, project pinning, master agents, media. Load BEFORE configuring a new bot or routing — multi-channel is the only mode now, the root bot_token/chat_id fields are legacy.
---

# apx-telegram

APX runs a Telegram plugin that polls `getUpdates` and routes messages. Config lives in `~/.apx/config.json → telegram`. The relationship to remember: **each channel can be pinned to a project and to a master agent**. Messages arriving on a pinned channel automatically run inside that project, optionally handled by a specific agent instead of the default APX super-agent.

## The shape

```json
{
  "telegram": {
    "enabled": true,
    "poll_interval_ms": 1500,
    "route_to_agent": "",          // global default master agent (empty = super-agent)
    "respond_with_engine": true,   // global default for "should the LLM auto-reply?"
    "channels": [
      {
        "name": "default",
        "bot_token": "<from BotFather>",
        "chat_id": "<your numeric chat id>",
        "project": "iacrmar",        // optional: pin this channel to that project
        "route_to_agent": "reviewer", // optional: this agent handles messages on this channel
        "respond_with_engine": true   // optional: override the global default
      }
    ]
  }
}
```

The old `telegram.bot_token` / `telegram.chat_id` at the root are **legacy**. Don't write to them. If a config still has them and `channels[]` is empty, APX migrates them into `channels[0]` automatically with a warning on first read.

## Concrete CLI calls

```bash
# Channels CRUD
apx telegram channel add               # interactive wizard
apx telegram channel add clientes --bot-token <T> --chat-id <C> --project iacrmar --agent reviewer
apx telegram channel list
apx telegram channel show clientes
apx telegram channel set    clientes --project iacrmar
apx telegram channel set    clientes --agent reviewer
apx telegram channel set    clientes --respond-engine false
apx telegram channel unset  clientes --project --agent
apx telegram channel remove clientes

# Polling lifecycle (rarely needed — autostart with daemon)
apx telegram start
apx telegram stop
apx telegram status

# Sending (defaults to first configured channel; use --chat for explicit chat id)
apx telegram send "texto"
apx telegram send "texto" --chat 123456789

# Media (daemon HTTP API — no dedicated CLI subcommand yet)
curl -X POST http://127.0.0.1:7430/telegram/send_photo \
  -H "Authorization: Bearer $(cat ~/.apx/daemon.token)" \
  -H "Content-Type: application/json" \
  -d '{"photo":"/abs/path.png","caption":"...","channel":"clientes"}'
curl -X POST http://127.0.0.1:7430/telegram/send_voice \
  -H "Authorization: Bearer $(cat ~/.apx/daemon.token)" \
  -H "Content-Type: application/json" \
  -d '{"audio":"/abs/path.ogg","duration":5,"channel":"default"}'
```

Every `channel` CRUD write triggers `POST /admin/reload` so the polling plugin picks up the new wiring without a daemon restart.

## What "pin to project" actually does

When a message arrives on a channel with `project: "iacrmar"`:
1. The super-agent invocation gets `channelMeta.projectId = <iacrmar's id>`.
2. The system prompt resolves project-scoped data (agents, MCPs, memory) for that turn.
3. The agent can call tools (`list_agents`, `list_tasks`, `create_task`, …) and they default to that project — the user doesn't have to say "in iacrmar" every message.

## What "master agent" actually does

With `route_to_agent: "reviewer"` on the channel, incoming messages go through `/projects/:pid/agents/reviewer/chat` instead of `/super-agent/chat`. The agent's `AGENT.md` system prompt + memory is used. No tools (project agents are `exec_agent`-shaped — text in, text out). Single LLM call.

Use this when you want a Telegram channel to feel like talking to a specific persona (a reviewer, a sales agent, a customer support agent) instead of the general APX assistant.

If `route_to_agent` is empty: the channel goes through the super-agent (default APX mode).

## Anti-examples

```bash
# DON'T write to telegram.bot_token / telegram.chat_id directly.
apx config set telegram.bot_token "<T>"
# ↑ Those fields are legacy. Use channels[] via `apx telegram channel`.

# DON'T add the same project to two channels expecting routing magic.
# A channel pins messages TO a project, not the other way around. The same
# project can be addressed from multiple channels — fine. But that doesn't
# unify the conversation contexts; each channel has its own message log.

# DON'T set route_to_agent to a non-existent slug.
apx telegram channel set default --agent nope
# ↑ Will silently route to a 404 — the channel's messages won't get a reply
# until you fix it. `apx telegram channel show <name>` to verify.
```

## Multiple bots, one APX

`channels[]` supports multiple `{bot_token, chat_id}` pairs. Each can be a different bot OR the same bot with different chats. The plugin polls each in parallel. Project / agent pinning is per-channel.

This is how you wire "I have a client A bot, a personal bot, and a notifications-only bot": three channels, three (possibly) different bots, distinct project pins.

## Don't

- Don't write to `telegram.bot_token` / `telegram.chat_id` at root.
- Don't expect `apx telegram send` to target a project — it sends to a *chat id* (or the channel's configured `chat_id`). Use `apx telegram channel show <name>` to verify wiring.
- Don't set `respond_with_engine: false` and then wonder why messages aren't getting replies. That flag turns auto-reply off for the channel.
- Don't forget that the Telegram plugin only fires on chat IDs you've listed. Messages from other chats are ignored.
