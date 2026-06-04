# 02 — Telegram config cleanup

**Priority**: P0
**Size**: XS
**Status**: idea

## Problem

`~/.apx/config.json → telegram` has redundant fields at the root level that became dead weight when channels were introduced:

```json
"telegram": {
  "enabled": true,
  "bot_token": "",                  ← LEGACY: empty, channels[].bot_token is the real one
  "chat_id": "",                    ← LEGACY: same
  "poll_interval_ms": 1500,
  "route_to_agent": "",             ← keep: useful as global default
  "respond_with_engine": true,      ← keep: useful as global default
  "channels": [
    { "name": "default",
      "bot_token": "8707…",
      "chat_id": "889721252",
      "respond_with_engine": true }
  ]
}
```

The empty root `bot_token` / `chat_id` confuses anyone reading the config — they look like missing setup.

## Decision

Remove `bot_token` and `chat_id` from the root `telegram` object. They are channel-level fields only.

Keep at the root:
- `enabled`: master switch.
- `poll_interval_ms`: shared polling cadence.
- `route_to_agent`: default master agent for channels that don't override (today already works this way).
- `respond_with_engine`: default LLM auto-reply behavior; channels override.
- `channels[]`: per-channel config (the real source).

## Migration

- `src/core/config.js → DEFAULT_CONFIG.telegram`: delete the two fields.
- `src/core/config.js → mergeDefaults`: same.
- Migration helper: when loading an existing config that still has root `bot_token` / `chat_id`, **don't drop them silently**. If `channels[]` is empty, build a single `default` channel from those legacy fields. Log a one-line warning so the user knows their config is being upgraded.
- Document in CHANGELOG.

## Files to touch

- `src/core/config.js`
- `tests/config.test.js` (already exists; add a case for the migration)

## Done criteria

- [ ] Fresh `~/.apx/config.json` (default install) has no empty `bot_token` / `chat_id` at root.
- [ ] Existing user configs with the legacy fields keep working (migrated into channels[] if channels was empty).
- [ ] Test covers the migration.
- [ ] CHANGELOG entry.

## Owner

Agent A (paralelo).
