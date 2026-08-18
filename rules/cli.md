# CLI

> Deep dive for [`AGENTS.md`](../AGENTS.md). The always-read constraint is
> rule **10** (adding a CLI command). Structure to follow for
> `src/interfaces/cli/`.

## The three folders — and what may live in each

| Folder | Owns | Must NOT contain |
|---|---|---|
| `commands/` | what a command DOES: parse flags → call core or `http` → print | domain logic, store readers/writers, prompt templates, second copies of core helpers |
| `routes/` | how args are parsed/dispatched to commands (+ `aliases`) | anything beyond argument rewriting |
| `help/` | the help surface — `topic({...})` declarative records | logic (it's a data file) |

There is no dispatch switch: `cli/index.js` looks the command up in
`routes/index.js` and lazily imports its route module, so a command loads only
what it uses.

## Recipe: adding `apx <name>`

1. `commands/<x>.js` — `export async function cmd<Name>(args)`. `parseArgs`
   yields `{ _: [positionals], flags }`.
2. `routes/<x>.js` — `export default async function route(rest, ctx)` mapping
   subcommands/flags to the command functions; `export const aliases = [...]`
   if any. Aliases are **per command** on purpose: `rm` means remove under
   `agent`, unset under `project config`, revoke under `pair` — never global.
3. Register in `routes/index.js`.
4. `topic({...})` in `help/index.js`. Note `buildHelp()` also hand-maintains a
   command listing — keep all three in sync (a cross-check test is on the
   survey backlog; until it exists, check by hand).
5. Branding: every command prints an `apx vX` mark via `branding.js`
   (`--version`/`update`/`init` get the big banner).
6. Reach the daemon via the `http` helper (auto-starts it). Read stdin via the
   existing helper — grep before writing one; `readStdinSync` has already been
   copy-pasted 5× and is queued for consolidation into `cli/stdin.js`.
7. Test the command function directly in `tests/` (offline — see
   [`testing.md`](testing.md)).
8. Update the matching `SKILL.md` (rule 6) and `docs/` page if user-facing.

## The thinness test (rule 8, CLI edition)

A command is an adapter. Before implementing an operation in a command, check:

- Does an `api/*.js` route already do it? → the logic belongs in `core/`,
  called by both. Never port a route's body into a command (or vice versa) —
  that's how the session store got three writers and the wakeup message got two
  implementations with different interruption-budget behavior.
- Is it pure computation over files/config (no daemon state)? → core function,
  called directly; the CLI should work offline where possible.
- Is there a prompt template in it? → rule 12: prompts live in
  `core/agent/prompts/`, never inline in a command.

Known counter-examples queued for extraction (don't grow them):
`commands/session.js` (session store + stale state machine + map-reduce
summarizer), `commands/skills.js` (inspector config dup of `api/skills.js`),
`commands/setup.js` (private Telegram client + second wakeup implementation),
`commands/agent.js` (agent-create transaction dup of `api/agents.js`).
Clean examples to copy: `commands/exec.js`, `commands/mcp.js`,
`commands/task.js`, `commands/desktop.js` (imports the same
`core/desktop/*` helpers as `api/desktop.js`).

## Output discipline

- One canonical name per command — no shorthand aliases beyond the declared
  per-command ones (project rule: no `apx a`-style abbreviations).
- Human output goes through the command's printer; anything another surface
  might need (summaries, listings) must come from a core function that returns
  data, with the command only formatting it.
