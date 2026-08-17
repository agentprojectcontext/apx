# P2 — Long-file refactors

The files below carry the most day-to-day friction: they are the ones an agent has
to load, understand and edit for almost any task, and every change in them is a
merge-conflict magnet.

Method for all of them: **extract without changing behavior, test after each step.**
No rewrite. The suite (779 tests) is the contract.

## P2-1 — `src/interfaces/cli/index.js` — 3001 lines

Four unrelated responsibilities in one module:

| Region | Lines | What it is |
|---|---|---|
| `HELP_TOPICS` + `HELP_ALIASES` | 209–2100 | ~1858 lines of help **data** |
| `parseArgs` | 2424 | ad-hoc arg parser |
| `dispatch()` | 2501–2958 | 458-line switch, **141** hand-written `sub === "..."` |
| branding | 184–197, 2970+ | banner/version marks |

The alias logic is copy-pasted: `sub === "list" \|\| sub === "ls"` appears **14
times**, the remove/rm pair 7 times.

**Target shape.** The repo already knows the right pattern —
`core/routines/runner.js:190` dispatches through a handler map, and `HELP_TOPICS` is
already declarative.

- `cli/help/topics.js` — the help data, moved verbatim.
- `cli/commands/registry.js` — a declarative command table: name, aliases,
  handler, help topic. Aliases are data, not repeated `||` chains.
- `cli/index.js` — parse, look up, invoke, brand. Target well under 300 lines.

**Watch out.** Every command must keep printing its `apx vX` mark, and
`--version`/`update`/`init` keep the big banner.

## P2-2 — `runAgent` — 551 lines, ~12 concerns

`src/core/agent/run-agent.js:130-680`. Inside one function body: model routing +
health fallback, tool-schema suppression via `Proxy`, the completion contract,
security-risk decoration, lazy-tool draining, greeting de-duplication (bilingual
regex), side-effect call de-duplication, stuck detection, engine retry with mid-loop
model rotation, the tool loop, and the wrap-up protocol.

**Target shape.** Extract each concern into a named collaborator under
`core/agent/loop/` with an explicit input/output, so each becomes independently
testable:

- `resolve-model.js` — routing + health chain + mid-loop rotation
- `side-effects.js` — the dedup ledger (see P3: `SIDE_EFFECT_TOOLS` must come from
  `tools/names.js`, not an inline literal Set)
- `greeting-guard.js` — the chit-chat short-circuit
- `tool-schema.js` — the `Proxy` suppression + risk decoration

`runAgent` keeps the loop and orchestrates the collaborators.

**Do this after P1** — the linter and CI make it safe, and this is the riskiest
refactor in the plan.

## P2-3 — `cli/commands/sessions.js` — 1008 lines in the wrong layer

This is a **domain engine living in a surface**: Claude Code JSONL scanning, project
path decode/encode, Codex rollout scanning, APX storage scanning, frontmatter
parsing, head/tail timestamp probing. Only ~200 lines actually print.

Because it is the only home for that logic, **two layers had to import upward**:

```
core/agent/tools/handlers/search-sessions.js:6  →  #interfaces/cli/commands/sessions.js
host/daemon/api/sessions.js:15                  →  #interfaces/cli/commands/sessions.js
```

**Target shape.** Extract to `core/sessions/`, absorbing the two narrower parallel
implementations that already admit the overlap in comments
(`core/stores/engine-sessions.js:6`, `core/stores/sessions-search.js`).
`encodeClaudeProjectPath` exists in **3** places — one survives.

This single move fixes: the core→interfaces violation, the host→interfaces
violation, two duplications, and one god file.

## P2-4 — `core/stores/messages.js` — 737 lines, four stores in one

Per-project FS ledger + SQLite rows + the global `~/.apx/messages` ledger + thread
listing/deletion, plus a type/actor inference layer and a **prompt-context
formatter** (`coalesceTurns`, `sanitizeAssistantForContext`). Storage and prompt
formatting are different jobs. Split them.

## P2-5 — `core/config/index.js` — 707 lines, half of it Telegram

Lines 547–700 are the Telegram identity/roster domain — `listTelegramChannels`,
`upsertContact`, `setChannelOwner`, `setRole`, and 8 more — embedded in the generic
config module, while `core/channels/telegram/` sits right there. `api/telegram.js`
imports 13 symbols from the config module because of it.

Move to `core/channels/telegram/config.js`, re-export for compatibility.

## P2-6 — `channels/telegram/dispatch.js` — `handleUpdate` 371 lines

Also the worst instance of the `self`-passing pattern: 14 exported functions take
the poller instance and mutate it (`self.channel` ×48, `self.log` ×27,
`self.globalConfig` ×14). The module header candidly explains that earlier splits
forgot fields and the bug only surfaced on a live update.

Lower priority than the rest of P2 — it is well-tested behavior and the risk/benefit
is worse. Split `handleUpdate` by message kind, keep the `self` contract explicit.
