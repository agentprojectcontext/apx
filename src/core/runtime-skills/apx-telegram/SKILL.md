---
name: apx-telegram
description: APX Telegram plugin — channels, project pinning, master agents, media. Load BEFORE configuring a new bot or routing — multi-channel is the only mode, root bot_token/chat_id are legacy.
---

# apx-telegram

APX polls `getUpdates` and routes messages. Config: `~/.apx/config.json → telegram`. Key model: **each channel can be pinned to a project and a master agent**. Messages on a pinned channel run inside that project, optionally handled by a specific agent instead of the default super-agent.

## Shape

```json
{
  "telegram": {
    "enabled": true,
    "poll_interval_ms": 1500,
    "route_to_agent": "",          // global default master agent (empty = super-agent)
    "respond_with_engine": true,   // global default auto-reply flag
    "channels": [
      {
        "name": "default",
        "bot_token": "<from BotFather>",
        "chat_id": "<numeric chat id>",
        "project": "iacrmar",          // optional: pin to project
        "route_to_agent": "reviewer",  // optional: per-channel agent
        "respond_with_engine": true,   // optional: override global
        "owner_user_id": "123456789"   // optional: via `apx telegram owner`
      }
    ],
    "contacts": [],   // global roster (user_id → role)
    "roles": {}       // role → allowed tools
  }
}
```

Root `telegram.bot_token` / `telegram.chat_id` are **legacy**. Don't write them. If a config still has them and `channels[]` is empty, APX migrates them into `channels[0]` automatically on first read.

## Concrete CLI calls

```bash
apx telegram setup            # template (still emits legacy root fields — prefer channels[])

# Channels CRUD
apx telegram channel add                  # interactive
apx telegram channel add clientes --bot-token <T> --chat-id <C> --project iacrmar --agent reviewer
apx telegram channel list                 # alias: ls
apx telegram channel show clientes        # alias: get
apx telegram channel set    clientes --project iacrmar
apx telegram channel set    clientes --agent reviewer
apx telegram channel set    clientes --respond-engine false
apx telegram channel unset  clientes --project --agent
apx telegram channel remove clientes      # alias: rm
apx telegram owner          clientes <user_id>

# Contacts roster + roles (global; gate which tools a sender may trigger)
apx telegram contacts
apx telegram contacts rm <user_id>
apx telegram role  <user_id> <role>
apx telegram roles
apx telegram roles set <name> --tools a,b,c     # or --tools '*'
apx telegram roles rm  <name>

# Polling lifecycle (autostarts with daemon)
apx telegram start
apx telegram stop
apx telegram status

# Sending (defaults to first configured channel)
apx telegram send "text"
apx telegram send "text" --chat 123456789
apx telegram send "text" --interrupt            # bypass pending-agent queue (also: --force)

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

Every `channel` CRUD write triggers `POST /admin/reload` so polling picks up the new wiring without restart.

## What "pin to project" does

On a message to a channel with `project: "iacrmar"`:
1. The super-agent invocation gets `channelMeta.projectId = <iacrmar's id>`.
2. The system prompt resolves project-scoped agents, MCPs, memory.
3. Tools (`list_agents`, `list_tasks`, `create_task`, …) default to that project — no need to repeat "in iacrmar" each message.

## What "master agent" does

With `route_to_agent: "reviewer"`, messages go through `/projects/:pid/agents/reviewer/chat` instead of `/super-agent/chat`. The agent's `AGENT.md` + memory is used. No tools (project agents are `exec_agent`-shaped — text in, text out). Single LLM call. Use this for persona channels (reviewer, sales, support) instead of the general assistant. Empty = super-agent (default).

## Anti-examples

```bash
# DON'T write to legacy root fields.
apx config set telegram.bot_token "<T>"   # ← use channels[] via `apx telegram channel`

# DON'T expect routing magic from same project on two channels.
# A channel pins messages TO a project, not vice-versa. Same project from multiple
# channels is fine, but each channel has its own message log — no unified context.

# DON'T set route_to_agent to a non-existent slug.
apx telegram channel set default --agent nope    # silently 404s; verify with channel show
```

## Multiple bots, one APX

`channels[]` supports multiple `{bot_token, chat_id}` pairs — different bots OR the same bot with different chats. Plugin polls each in parallel; project/agent pinning is per-channel. Wire "client A bot, personal bot, notifications-only bot" as three channels.

## Don't

- Write to `telegram.bot_token` / `telegram.chat_id` at root.
- Expect `apx telegram send` to target a project — it targets a *chat id*. Verify wiring with `apx telegram channel show <name>`.
- Set `respond_with_engine: false` and then wonder why replies stop. That flag disables auto-reply for the channel.
- Forget the plugin only fires on listed chat IDs. Other chats are ignored.
