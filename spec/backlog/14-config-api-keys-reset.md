# 14 — API keys in ~/.apx/config.json got cleared during the session

**Priority**: P1
**Size**: S (investigation) + S (test guard)
**Status**: idea

## Problem

Mid-session on 2026-05-27 the keys at `engines.groq.api_key`,
`engines.openrouter.api_key`, `engines.gemini.api_key`, and
`voice.tts.gemini.api_key` all reset to empty strings without anybody
intentionally touching them.

Repro path is unclear: the bug landed between the start of the session
(keys present) and a routine `apx daemon reload` (keys gone). Suspects, in
order:

1. **`mergeDefaults()`** in `core/config.js` — when reading a config that
   doesn't have a sub-tree we use the default, but the merge functions are
   spread-based so any caller that wrote a partial cfg back via
   `writeConfig()` would have wiped sibling fields. Look for any
   `writeConfig({ <partial> })` rather than `writeConfig(readConfig(); …)`.
2. **`apx config set`** with a structural typo could overwrite the whole
   `engines` block instead of just the key.
3. **A wizard / setup re-run** that overwrote `cfg.engines` with the empty
   defaults.
4. **Codex's pairing branch** writing config without preserving keys.

## Investigation plan

1. `grep -rn writeConfig src/` and audit every call site:
   - Must read fresh from disk first.
   - Must write the full cfg, not a partial.
   - If the caller only owns a sub-tree, prefer `mergeDeep(disk, patch)`
     over `Object.assign(disk, patch)` with shallow merges.
2. Add a test that round-trips a populated config through writeConfig +
   readConfig and asserts every api_key + base_url survives.
3. Add a runtime guard: in `writeConfig(cfg)`, if any previously-non-empty
   `engines.<provider>.api_key` is about to be cleared, refuse the write
   and log a stack trace. False positives are easier to debug than a
   silent key loss.

## Workaround now

Manually restored the three keys (Groq, OpenRouter, Gemini) from a known
source. No reload needed beyond the existing /admin/reload.

## Done criteria

- [ ] All `writeConfig` callers verified to round-trip the full file.
- [ ] Test covers the round-trip.
- [ ] Optional: opt-in guard in writeConfig that refuses to drop keys.

## Owner

Unassigned. Estimate 1-2h depending on whether guard is added.
