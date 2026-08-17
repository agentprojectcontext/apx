# P0 — Context & build blockers

Highest priority: this is the reported problem. All cheap, all high impact.

## P0-1 — Stop truncating the project's own AGENTS.md

**Bug.** `src/core/agent/prompt-builder.js:128` sets `PROJECT_AGENTS_MAX_CHARS = 6000`
and line 138 hard-slices. Our `AGENTS.md` is 16301 chars, so the agent receives 37%
of its own contract, cut mid-word inside rule 11. Rules 12–14 and every section
after (conventions, web, prompts, memory, desktop, docs) never arrive.

**Fix.** Truncation is a guard against a *foreign* project blowing the prompt
budget. It must not apply when APX is running inside the project that owns the file.

- Keep a cap for foreign projects, raised to a sane budget.
- No cap (or a much larger one) for the active/own project.
- Make the limit configurable rather than a magic number.
- When a truncation does happen, say so with the real numbers, not a bare marker.

**Acceptance.** A test proves a 16k-char project `AGENTS.md` reaches the prompt
whole for the owning project, and that a foreign project still gets bounded.

## P0-2 — Fix the wrong paths in AGENTS.md

Every row below misdirects an agent, and rows 1–2 sit on lines the file itself
labels as footguns.

| Says | Reality |
|---|---|
| `API_PREFIXES` in `api/shared.js` | `src/host/daemon/api/web.js:23` |
| `runSuperAgent()` in `host/daemon/super-agent.js` | `src/core/agent/super-agent.js` |
| `super-agent-base.md` | `prompts/core/super-agent.md` |
| `prompts/action-discipline.md` | `prompts/discipline/action.md` |
| identity fallback `"Superagente"` | `"APX"` (`core/identity/self.js:13`) |
| update `skills/<slug>/SKILL.md` (3 skills) | real target is `src/core/runtime-skills/` (19 skills) |

Also: layout section omits 11 `src/core/` subdirs, the `acp/` interface, and the
`antigravity` runtime.

**Acceptance.** A test walks the file paths named in `AGENTS.md` and fails if one
does not exist. This makes rule 17 of [conventions](./00-conventions.md) enforceable.

## P0-3 — Fix the TUI tsconfig

`src/interfaces/tui/tsconfig.json:2` extends `../../../tsconfig.cli.json`, which
does not exist. 23709 lines across 152 files are unverifiable, and because nothing
runs it the breakage is invisible.

**Fix.** Provide the missing base config (or inline the settings), so
`tsc -p src/interfaces/tui --noEmit` loads. The TUI is a vendored fork with 162
`any`s and a `_shims/` directory, so the initial gate is "config resolves and the
check runs", not "zero errors" — then ratchet.

## P0-4 — Kill the phantom dirty diff

`skills/apc-context/SKILL.md` is both tracked and gitignored, so the prepack sync
rewrites it into a permanent uncommitted diff that every agent sees in `git status`
and has to guess about. `git rm --cached` it and document which of the three
identical copies (`skills/`, `src/skills/`, `src/core/runtime-skills/`) is canonical.

## P0-5 — Remove search noise

`.claude/worktrees/` holds two abandoned full checkouts: 130 of the repo's 272
markdown files, including two decoy `AGENTS.md`. Any recursive grep by an agent
ingests them. Remove the stale worktrees.
