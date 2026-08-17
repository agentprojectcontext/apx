# Repair & Refactoring — work plan

> Branch: `repair-and-refactoring-code` · Baseline: 779 tests green, 0 skipped.
> Source: full-repo survey (architecture, code quality, guardrails, docs), 2026-08-16.

## Why this exists

Coding agents working on this repo cross wires. The survey found the cause is not
sloppy code — the code is better cared for than average (one `TODO` in the whole
repo, no commented-out blocks, good module headers). The cause is three things
compounding:

1. **The context contract is silently truncated.** APX slices any project
   `AGENTS.md` at 6000 chars — including its own. Our `AGENTS.md` is 16301 chars,
   so 63% never reaches the agent, and the cut lands mid-word inside rule 11.
   Other tools (Claude Code, Codex) read the whole file, so the same repo behaves
   differently depending on which tool you ask. **This is an APX bug, not a docs
   problem** — a project reading its own contract must never be truncated.
2. **Several paths in the contract are wrong, precisely at the lines flagged as
   footguns.** An agent obeying the warning edits the wrong file.
3. **Almost every concept has 3–7 equally plausible homes**, and nothing
   mechanical (no linter, no PR CI, no backend types) catches the wrong choice.

## The general improvement

One idea runs through the whole plan: **give the codebase a shared kernel and make
the layering machine-enforced.**

- Today every module re-derives `~/.apx` paths (27 sites), re-implements JSON
  read/write (35+ sites), scope normalization (5 copies), frontmatter parsing
  (4 copies) and project resolution (7 copies). Each copy is a place to drift.
- Today `core → adapter → surface` is prose. Three live imports invert it.

So: extract the primitives into `core/util` + `core/constants`, delete the copies,
and add an ESLint `no-restricted-imports` rule that turns the layering rule into a
build error. After that, an agent that picks the wrong home gets a red X instead of
a merged mistake.

## Order of work

Guardrails come before the big refactors on purpose: the linter and the CI gate are
~1 hour of work, and they make every refactor after them safe. The long-file
refactors start immediately after.

| # | Phase | Why it ranks here | Spec |
|---|-------|-------------------|------|
| **P0** | Context & build blockers | The reported problem. Cheap, immediate. | [P0](./P0-context-blockers.md) |
| **P1** | Mechanical guardrails | Safety net for everything after. | [P1](./P1-guardrails.md) |
| **P2** | Long-file refactors | Highest day-to-day friction. | [P2](./P2-long-files.md) |
| **P3** | Shared kernel & dedup | Removes the "many plausible homes" problem. | [P3](./P3-kernel-dedup.md) |
| **P4** | Layering repair | Fixes inverted dependencies for good. | [P4](./P4-layering.md) |
| **P5** | Test hardening | No skips, dangerous handlers covered. | [P5](./P5-testing.md) |
| **P6** | Cleanup | Dead code, unused deps, stale docs. | [P6](./P6-cleanup.md) |

Rules and conventions that must hold from now on: [conventions](./00-conventions.md).

## Definition of done

- `npm run preflight` green (backend tests + web build + web `tsc --noEmit`).
- `npm test` → 100% pass, **0 skipped, 0 todo**.
- `npx eslint .` → 0 errors.
- No import inverts a layer (`core` never imports `#host`/`#interfaces`;
  `host` never imports `#interfaces`).
- Daemon restarts clean and answers on `/api`.

## Progress

| Phase | State |
|---|---|
| **P0** Context & build blockers | done |
| **P1** Mechanical guardrails | done |
| **P2** Long-file refactors | done |
| **P3** Shared kernel & dedup | done |
| **P4** Layering repair | done |
| **P5** Test hardening | done |
| **P6** Cleanup | mostly done |

Verified before merging: `npm run preflight` exit 0 — lint clean, 861 tests,
0 skipped, 0 todo, web build, web `tsc --noEmit`, TUI ratchet at baseline.
Daemon restarts and answers on `/api`; the tool catalog executes; the
super-agent completes a turn and calls `send_telegram`.

### Numbers

| | before | after |
|---|---|---|
| `cli/index.js` | 3001 lines | 158 |
| `core/http-tools/registry.js` | 738 | 138 + catalog + handlers |
| `core/config/index.js` | 711 | 549 |
| `host/daemon/stt-venv.js` | 111 | 38 |
| Tests | 779 | 861 |
| Coverage (line) | 63.2% | 72.3% |
| Linters | none | ESLint, layer rule enforced |
| CI on pull request | none | lint + tests + builds |
| Dead exports | 132 | 116 |

### Deliberately left open

- **116 dead exports**, one or two per module. Each needs the same
  demote-then-check pass used on `stt-venv.js`; doing them in bulk is how you
  break something quietly.
- **12 inline `JSON.parse(readFileSync)`** that must stay explicit — a corrupt
  `~/.apx/config.json` has to throw, not resolve to an empty config. Documented
  in `core/util/json-file.js`.
- **`core/stores/messages.js`** (737 lines) still holds four stores plus a
  prompt formatter. The split is real work and wants its own change.
- **`runAgent`** keeps ~10 concerns after the two user-facing guards came out.
  It is the riskiest refactor in the plan and deserves to land alone, now that
  the linter and CI exist to catch a mistake.
- **The TUI** stays at its 176-error typecheck baseline. It is a vendored fork;
  the ratchet stops it getting worse.

### Two corrections to the original survey

Both are recorded because the pattern matters more than the instances:
**identical names are not identical behaviour.**

1. `normalizeScope` ×5 was reported as duplication. The three under `api/` have
   different vocabularies (`shared|runtime|global` vs `project|global`, with
   different defaults). Merging them would have rerouted writes to the wrong
   store. Renamed instead — see [P3](./P3-kernel-dedup.md).
2. `resolveProject` ×7 was likewise five different operations. Only one had
   real drift: session search accepted an id or exact path but not a name.

A third: the `API_PREFIXES` "footgun" the survey flagged in `AGENTS.md` no
longer existed — the `/api` cutover had replaced it with a structural seam.
Rule 9 was documenting a file that was gone.
