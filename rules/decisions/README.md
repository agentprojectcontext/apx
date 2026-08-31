# Architecture decisions

> Deep dive for [`AGENTS.md`](../../AGENTS.md). These are the **durable** decisions:
> the ones a reader has to know to understand why the code is shaped this way.
> Planning, roadmaps and backlogs are not decisions and do not live here — they
> stay local under `spec/` and never ship with the repo.

These five were local-only for months, under a gitignored `spec/decisions/`,
while `AGENTS.md`, `rules/README.md`, `rules/architecture.md`, `rules/web-ui.md`
and `src/interfaces/web/README.md` all linked to them. On GitHub and in any
fresh clone those were dead links pointing at files that were never pushed. They
are tracked now — that is the whole reason this directory exists.

| # | Decision | Status |
|---|---|---|
| [001](001-core-host-interfaces.md) | Three layers: `core` / `host` / `interfaces` | **accepted** — the single most load-bearing decision here; rule 8 and the ESLint layer guard both come from it |
| [002](002-super-agent-is-mode-not-name.md) | "super-agent" is a mode, not a persona name | **accepted** — rule 4 |
| [003](003-web-interface-in-monorepo.md) | Web admin in this repo; Android out | **partly superseded** — the web half held, the Android half was reversed in practice |
| [004](004-piper-default-local-tts.md) | Piper is the recommended local TTS | **accepted** — still first in the `auto` chain |
| [005](005-no-radix-on-web-panel.md) | No Radix-based libraries in the web panel | **accepted** — rule 11, and now machine-enforced by `tests/web-guardrails.test.js` |

## Writing one

A decision belongs here when reversing it would mean editing many files, or when
the *absence* of the reasoning would make someone "fix" the code back to the
obvious-but-wrong shape. Four sections: **Context**, **Decision**,
**Consequences**, **Supersedes / superseded by**. Date it and give it a status.

Two house rules, both learned the hard way in this directory:

- **Never cite a path you have not opened.** ADR 003 named three files
  (`plugins/remote.js`, `api/remote.js`, `lib/apx-client.ts`) that were planned
  and never built. A reader chasing them concludes the doc describes a different
  codebase — which is the same failure mode as a stale comment (see
  [`architecture.md`](../architecture.md), "comments are decision records").
- **When reality reverses a decision, amend the ADR — don't leave it standing.**
  A confidently-worded decision the code no longer follows is worse than no
  decision at all: it is an instruction to undo working code.
