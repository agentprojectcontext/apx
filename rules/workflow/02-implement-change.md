# 02 — Implement

> Follow the architecture that is here. Not the one you would have built.

## The shape

- **`core/` owns the operation.** Adapters parse input, call one core function,
  shape output. If you are writing logic inside `api/*.js` or `cli/commands/*`,
  stop and move it down.
- **Extension is the registry pattern.** New engine → a file in `core/engines/`
  plus one line in `ADAPTERS`. New runtime, tool handler, embed engine, CLI
  route: same shape. Adding a member must never edit its siblings.
- **An adapter honors the whole contract, or declares that it cannot.** Silently
  ignoring an option you were handed is the `onToken` bug — accepted by seven
  engines, honored by two, streaming quietly degrading per provider. Declare a
  capability field instead of swallowing.
- **Imports use `#core/*` / `#host/*` / `#interfaces/*`**, never `../../../`.
  Same-folder neighbors stay relative.
- **Never inline a constant that has a home**: tool names (`tools/names.js`),
  channels, actors, permission modes, `~/.apx` paths. The de-duplication that
  stops a Telegram message being sent three times keys off tool *names*.

## Keep the diff narrow

One task, one change. An unrelated cleanup spotted along the way goes in the
brief as a note, not in the diff — it is the fastest way to make a change
unreviewable, and stage 3 is the thing you are protecting.

## Preserve observability

Do not replace an explicit failure with a silent fallback. This system's
characteristic bug is something that stops working without saying so. If you add
a `catch`, it either logs or re-throws — never both-nothing.

## Tests ship with the change (rule 1)

- A new route, command, plugin or config key lands with a test.
- **A bug fix lands with a regression test that fails before the fix**, and the
  commit body says which test would have caught it.
- Anything that writes files, runs a shell, changes a permission mode or
  messages a human needs a direct test.
- Tests set **`process.env.APX_HOME`** before importing the module — not `HOME`
  alone. `computeHome()` checks `APX_HOME` first, so a test that only moves
  `HOME` silently shares the one run-wide sandbox and races every other such
  test. Details: [`testing.md`](../testing.md).
- No skipped tests, ever. `test:ci` fails on `skipped` or `todo`.

## Update what the change falsifies

In the **same** change (rule 6):

- The matching `SKILL.md` — look in `src/core/runtime-skills/<slug>/` first.
- **A changed default rarely falsifies one skill.** `grep` all of
  `src/core/runtime-skills/*/SKILL.md` for the old claim; the tools-default
  reversal falsified three at once.
- `docs/` — both EN and ES — for any user-visible behaviour. Build it:
  `cd docs && pnpm build` (docs are not in preflight).
- The comment above the code, if it described the thing you just changed.
  Comments here are decision records and agents trust them instead of re-reading
  the code; a stale one is worse than none.
