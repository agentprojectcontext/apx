# P5 — Test hardening

Baseline: **779 tests, 779 pass, 0 skipped, 0 todo, ~3.5s.** The suite is healthy;
the problem is what it does *not* reach.

## P5-1 — Cover the dangerous handlers

227 modules live under `src/core`; only 91 are referenced by any test. The gap that
matters most: **~50 modules under `core/agent/tools/handlers/` have no test**,
including the ones that can damage a user's machine.

Priority order:

1. `run-shell` — arbitrary command execution
2. `write-file`, `edit-file` — filesystem mutation
3. `set-permission-mode` — the autonomy gate itself (and it hardcodes the three
   modes three times instead of importing `PERMISSION_MODES` — see P3-6)
4. `read-file`, `list-files`, `search-files`
5. `call-runtime`, `call-mcp`, `call-agent`

## P5-2 — Cover the human-in-the-loop path

`core/confirmation/index.js` and **all four** adapters (`code`, `telegram`,
`terminal`, `web`) are untested. Two of them (`code.js`, `terminal.js`) are also
imported by nobody — the abstraction is half-built, so this phase decides: finish it
or delete the dead adapters (see P6).

## P5-3 — Other blind spots

- **Telegram channel layer** — all of `core/channels/telegram/*`
  (`api`, `dispatch`, `reply`, `helpers`, `media`, `ask`, `ask-callbacks`,
  `inbound/audio`, `inbound/photo`).
- **Engines** — `anthropic`, `openai`, `gemini`, `groq`, `openrouter`, `catalog`,
  `presets`, `_health` (only `ollama`, `openai-compatible`, `_streaming` are tested).
- **Embedding engines** — all of `core/memory/embed-engines/*`.
- **`core/config/redact`** — secret redaction, untested despite a
  `secret-masking.test.js` existing that targets a different module.
- **9 daemon routes with zero test mention**: `admin-config`, `artifact-preview`,
  `connections`, `files-project`, `inbox`, `sessions-search`, `shared`,
  `top-level`, `transcribe`. `shared` holds `API_PREFIXES` — the source of truth the
  vite proxy must mirror, and drift there silently breaks dev.

## P5-4 — Structural fixes to the suite

- **The glob is single-level.** `node --test tests/*.test.js` silently skips any
  nested test file. Currently 0 nested files, so no live bug — but the first person
  to add `tests/core/foo.test.js` loses it silently. Use a recursive glob.
- **No coverage tooling at all** — no c8, nyc, or `--experimental-test-coverage`.
  Add it with a threshold that ratchets up.
- **No skipped tests policy** — enforce `skipped 0 / todo 0` in CI, not just by
  convention (see [conventions](./00-conventions.md) rule 1).

## P5-5 — Playwright e2e is orphaned

`src/interfaces/web/e2e/` is genuinely well-built: 11 numbered specs, `fixtures.ts`,
a `global-setup.ts` that registers a throwaway project via `apx init` in a temp dir,
teardown, and a custom dated reporter. It runs **manually only** — no CI job, not in
the pre-push hook. Wire it into CI (or at minimum a nightly), since it is the only
thing testing the web surface end to end.
