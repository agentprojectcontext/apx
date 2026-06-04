# 15 — Telegram bot slot conflict detection + recovery

**Priority**: P1
**Size**: S
**Status**: idea

## Problem

Telegram allows exactly one client per bot to long-poll `getUpdates`. When a
second client connects with the same token, Telegram returns **`409
Conflict: terminated by other getUpdates request`** to whichever lost the
race.

This happens in practice when:
- The user runs `mcp-telegram-agent` or `mcp_telegram_notify` (or any other
  MCP server that polls the same bot) in parallel with the APX daemon.
- Stale npx-spawned processes survive across sessions (we saw 10+ zombi
  `npm exec mcp-telegram-agent` processes from earlier in the day).
- A `curl getUpdates` during debugging steals the slot.

Today the APX daemon backs off exponentially when 409 hits, but:
- The log line is generic ("getUpdates 409; backing off Nms"); the user
  doesn't know the slot is occupied by another process they can kill.
- There's no recovery — once stuck, only a full daemon restart + 30-60s
  wait clears the Telegram-side long-poll cache.

## Decision

1. **Better log message** on the first 409 of a session: include the bot id
   the daemon thinks it owns + a one-line hint telling the user to look for
   competing processes. Something like:

   ```
   [WARN] [telegram] getUpdates 409 — another client is polling this bot
                     (id=8717840764). Find it with:
                       lsof -i -P -n | grep 149.154.   OR
                       ps aux | grep -iE 'telegram|mcp.telegram'
                     Kill it, then run: apx telegram stop && sleep 30 && apx telegram start
   ```

2. **`apx telegram doctor`** command:
   - Calls `getMe` to confirm the token still works.
   - Calls `getUpdates?offset=-1&timeout=0&limit=1` to confirm the bot has
     no other long-poll holder.
   - Lists local PIDs likely competing (any process matching
     `mcp.telegram|telegram.notify|telegram.agent`).
   - Suggests next action.

3. **Self-recovery in the plugin**: after N consecutive 409s with backoff
   over a threshold (say 60s cumulative), the plugin emits a
   `telegram_slot_contention` event and stops trying. The user gets a
   clear error in `apx status` instead of a silent ramp.

## Workaround today

```bash
pkill -f "mcp-telegram-agent"
pkill -f "mcp_telegram_notify"
apx daemon stop
sleep 30
apx daemon start
```

This is the same recipe that recovered the daemon on 2026-05-27.

## Files to touch

- `src/host/daemon/plugins/telegram.js` — improved 409 message + retry-cap event.
- `src/interfaces/cli/commands/telegram.js` — new `doctor` subcommand.
- `tests/telegram-doctor.test.js` (new).

## Done criteria

- [ ] First 409 of a session logs a specific message naming the bot id and
  the diagnose command.
- [ ] `apx telegram doctor` returns a structured report.
- [ ] `apx status` surfaces "Telegram slot contention" when the threshold
  is crossed.

## Owner

Unassigned. ~1h with tests.
