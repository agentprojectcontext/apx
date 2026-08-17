# Hardened conventions

> These tighten the existing `AGENTS.md` rules. Where they conflict with a bullet
> in `AGENTS.md`, these win and `AGENTS.md` gets updated in the same change.

## Testing

1. **No skipped tests. Ever.** `test.skip`, `it.skip`, `describe.skip` and
   `test.todo` are forbidden on `main` and on any branch that is asked for review.
   A test that cannot run is either deleted with a reason in the commit body, or
   fixed. `npm test` must report `skipped 0` and `todo 0`.
2. **A test asserts behavior, not implementation.** Prefer driving a route through
   `buildApi()` + `app.listen(0)` or a CLI command function over asserting on
   internal call order.
3. **Every bug fix lands with a regression test that fails before the fix.**
   State in the commit body which test would have caught it.
4. **Tests are offline and hermetic.** No network, no API keys, no live daemon.
   Anything writing under `~/.apx` sets `process.env.HOME` to a temp dir *before*
   importing the module under test.
5. **Dangerous surfaces are covered.** Any tool handler that writes files, runs a
   shell, changes a permission mode, or sends a message to a human must have a
   direct test. These are the handlers that can damage a user's machine.
6. **Coverage does not go down.** The suite runs with
   `--experimental-test-coverage`; the threshold ratchets up, never down.

## Layering

7. **`core` imports nothing from `#host` or `#interfaces`. `host` imports nothing
   from `#interfaces`.** This is enforced by ESLint `no-restricted-imports`, not by
   good intentions. If core needs something that lives in an adapter, the thing is
   misfiled — move it into core.
8. **A route or command file is an adapter.** It parses input, calls one core
   function, and shapes output. If an `api/*.js` or `commands/*.js` file grows a
   second responsibility (a state machine, a spawn, a regex over model output), that
   work belongs in `core/`.
9. **One operation, one implementation.** Before writing a helper, grep for it.
   Scope normalization, frontmatter parsing, project resolution, JSON file I/O and
   `~/.apx` paths all have exactly one home — use it.

## Primitives

10. **Never rebuild a path from `os.homedir()`.** Import from `#core/config/paths.js`.
11. **Never `JSON.parse(fs.readFileSync(...))` inline.** Use the helpers in
    `#core/util/json-file.js` — they handle missing files, corrupt JSON and atomic
    writes consistently.
12. **Never inline a channel, permission mode, actor, scope or tool name.** Import
    the constant from `#core/constants/*` or `#core/agent/tools/names.js`. A renamed
    tool must not silently disable a safety check.

## Daemon behavior

13. **The daemon never blocks the event loop on a request path.** New I/O in a
    route handler uses `fs/promises`. Sync I/O is acceptable only at boot.
14. **Every async route handler is wrapped.** Use the shared `asyncRoute()` helper
    so a rejected promise becomes a 500, not a dead process.
15. **The process listens for `unhandledRejection` as well as `uncaughtException`.**

## Context

16. **A project's own `AGENTS.md` is never truncated.** Truncation exists to bound
    the prompt for *foreign* projects; the project APX is running inside gets its
    full contract.
17. **When a rule names a file, the file path is verified in the same change.** A
    wrong path in `AGENTS.md` is worse than no path — it actively misdirects.
