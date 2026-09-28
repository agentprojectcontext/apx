---
name: apx-discord
description: APX Discord channel — a bot on a community server, an allowlist of rooms with a mode each (always / mention / read), and a sealed turn for everyone. Load BEFORE adding or changing a Discord room, setting the bot up, posting to Discord, or explaining why the bot did or did not answer.
---

# apx-discord

One Discord bot, run by the daemon plugin `discord`. Config lives at `~/.apx/config.json → discord`; the token is `discord.token` and is never printed or returned by any command.

## Rooms are denied by default

A room that is not listed does not exist: not stored, not indexed, never answered. Each listed room has a mode:

| Mode | Speaks |
|---|---|
| `always` | on every message (a help room) |
| `mention` | only when called — @mention, a reply to the bot, or one of `discord.names` as a whole word |
| `read` | never; stored and summarised only |

A thread inherits its parent room's mode unless listed itself. Mode changes apply to the next message, no restart. A new token or `enabled` needs `apx restart`.

```bash
apx discord status
apx discord channels
apx discord channel set <channel_id> <always|mention|read> [--name <name>]
apx discord channel remove <channel_id>
pbpaste | apx discord set --token-stdin
apx discord set --owner <user_id,…> --names roby --knowledge /path/to/about.md
```

Ids are Discord snowflakes (digits). Never guess one — ask the owner to copy it (Developer Mode → Copy Channel ID).

## Why it did not answer

Decided by code, in this order, before any model runs: room not listed → own message → empty → another bot (stored, never answered) → `read` room → `mention` room and not called → per-person cooldown (`limits.user_cooldown_ms`) → per-room hourly cap (`limits.channel_replies_per_hour`). The owner's own account skips the two limits, not the mode. The daemon log says which one applied (`apx daemon logs`).

A burst from one person inside `limits.burst_window_ms` gets ONE answer.

## Every turn is sealed

Owner included: no tools, no private memory, no other channel, no projects. The bot answers from the room's recent messages, its running summary, recall from that room's own index (`discord:<channel_id>` scope) and the public knowledge file. Do not tell anyone the bot can look something up in the code or docs — it cannot. If it keeps missing an answer, the fix is the knowledge file.

## Posting

`POST /api/discord/send { channel_id, text }` posts as the bot, only to a listed room, and records it in the ledger. Mentions are disabled at the API level. There is no agent tool for this yet: do not post to a public room unless the owner asked for that exact message.
