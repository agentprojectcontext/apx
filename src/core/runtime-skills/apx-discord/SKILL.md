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
| `useful` | when called, and uncalled when a cheap model check (`discord.reply_when`, default: concrete project questions only) says it can help; capped by `limits.gate_checks_per_hour` |
| `mention` | only when called — @mention, a reply to the bot, or one of `discord.names` as a whole word |
| `read` | never; stored and summarised only |

A thread inherits its parent room's mode unless listed itself. Mode changes apply to the next message, no restart. The web panel has the same controls at **Settings → Discord**; saving a new token there reconnects the bot (`POST /api/discord/reconnect`) — from the CLI, a new token or `enabled` needs `apx restart`.

```bash
apx discord status
apx discord channels
apx discord channel set <channel_id> <always|useful|mention|read> [--name <name>]
apx discord channel remove <channel_id>
pbpaste | apx discord set --token-stdin
apx discord set --owner <user_id,…> --names roby
apx discord set --knowledge-stdin < notes.md   # what the bot can do and answer (≤12k chars)
```

Ids are Discord snowflakes (digits). Never guess one — ask the owner to copy it (Developer Mode → Copy Channel ID).

## Why it did not answer

Decided by code, in this order, before any model runs: room not listed → own message → empty → another bot (stored, never answered) → `read` room → `mention` room and not called → per-person cooldown (`limits.user_cooldown_ms`) → per-room hourly cap (`limits.channel_replies_per_hour`). The owner's own account skips the two limits, not the mode. The daemon log says which one applied (`apx daemon logs`).

A burst from one person inside `limits.burst_window_ms` gets ONE answer.

## Every turn is sealed

Owner included: no tools, no private memory, no other channel, no projects. The bot answers from the room's recent messages, its running summary, recall from that room's own index (`discord:<channel_id>` scope) and the owner's notes (`discord.knowledge`, edited in Settings → Discord). Do not tell anyone the bot can look something up in the code or docs — it cannot. If it keeps missing an answer, the fix is the owner's notes.

## Rules and the guardrail

`discord.rules` (Settings → Discord → *Rules for what it says*, ≤2000 chars) is placed LAST in every Discord turn and wins over the notes. Independently of the model, every post goes through `guardDiscordReply` (core/channels/discord/outbox.js): registered secrets masked, local paths replaced, `@everyone`/`@here` defused. Do not tell the owner a rule is "enforced" beyond that — the rules are prompt, the guard is code.

The owner (an id in `discord.owner_ids`, never a display name) is addressed as the owner: by `identity.owner_name`, familiar. Still sealed — the familiarity is tone, not access. Their messages are stored with `meta.owner: true` and the panel draws them on the owner's side.

## Posting

`POST /api/discord/send { channel_id, text }` posts as the bot, only to a listed room, and records it in the ledger. Mentions are disabled at the API level. There is no agent tool for this yet: do not post to a public room unless the owner asked for that exact message.
