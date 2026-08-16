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

Tracked in the harness task list; each phase spec carries its own checklist.
