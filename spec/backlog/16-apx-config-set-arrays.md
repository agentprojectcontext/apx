# 16 — `apx config set` doesn't apply array values reliably

**Priority**: P2
**Size**: XS
**Status**: idea

## Problem

`apx config set super_agent.model_fallback.models '["a","b","c"]' --json`
prints the right "set …" confirmation but the value **does not land in
disk**. Observed 2026-05-27: after running the command, `~/.apx/config.json`
still had the previous array.

For scalar values (`apx config set super_agent.model "ollama:gemma4"`) the
flow works.

## Likely cause

`src/interfaces/cli/commands/config.js` parses the value, but either:
1. The `--json` flag isn't propagating to the value parser.
2. The PATCH endpoint receives an empty / wrong-shaped payload.
3. The reload happens before the write commits.

## Workaround

Edit `~/.apx/config.json` directly and run `apx daemon reload`. Documented
in `apx-project` and `apx-telegram` skills already; this just makes the
CLI shortcut reliable for arrays/objects too.

## Done criteria

- [ ] `apx config set <dotted.key> '<JSON>' --json` writes the parsed value
  to disk.
- [ ] Daemon reload picks up the new value (already does — bug is upstream).
- [ ] Test covers array + nested object cases.

## Owner

Unassigned. ~30 min with tests.
