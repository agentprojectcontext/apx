# Engineering guardrails

The engineering contract for working **on** apx. [`AGENTS.md`](../AGENTS.md) is
the hub and carries the **always-read** part — the glossary, the dev loop, the
numbered rules 1–17. Everything here is **read-on-demand**: open a file when you
are in that situation, not before.

> Not to be confused with [`docs/`](../docs/), which is the **public** Astro +
> Starlight site for people *using* APX. Nothing in this directory is published.
> When a change affects both, both get updated in the same change (rule 6).

## Start here

| File | Read it when |
|---|---|
| [`human-model.md`](human-model.md) | **you are the owner, not the author** — what this system is, what breaks what, what is actually guaranteed |
| [`enforcement.md`](enforcement.md) | **before trusting any rule** — which are build errors and which are only prose, plus the three-pnpm-projects trap |
| [`surfaces.md`](surfaces.md) | who can reach the daemon, holding what credential, carrying what state |

## The workflow

[`workflow/`](workflow/) — how a change moves from idea to shipped. Eight
playbooks, one per stage.

| | | |
|---|---|---|
| [`01-plan-change`](workflow/01-plan-change.md) | [`02-implement-change`](workflow/02-implement-change.md) | [`03-independent-review`](workflow/03-independent-review.md) |
| [`04-security-risk-review`](workflow/04-security-risk-review.md) | [`05-test-and-runtime`](workflow/05-test-and-runtime.md) | [`06-architecture-drift`](workflow/06-architecture-drift.md) |
| [`07-owner-brief`](workflow/07-owner-brief.md) | [`08-incident-map`](workflow/08-incident-map.md) | |

## Subsystems

| File | Read it when you're touching… |
|---|---|
| [`architecture.md`](architecture.md) | any structural decision — layering, SOLID, registries, where logic lives |
| [`repo-layout.md`](repo-layout.md) | finding where a thing lives / where a new thing goes |
| [`daemon-api.md`](daemon-api.md) | HTTP routes, `asyncRoute`, plugins, WebSocket hubs |
| [`cli.md`](cli.md) | CLI commands, routes, help, aliases |
| [`testing.md`](testing.md) | writing/harnessing tests, coverage floor, preflight |
| [`web-ui.md`](web-ui.md) | the React + Vite admin panel |
| [`prompts-and-channels.md`](prompts-and-channels.md) | prompt assembly, channels, lazy tools, skill surfacing |
| [`memory.md`](memory.md) | embeddings, message store, compaction, vector index |
| [`recipes.md`](recipes.md) | engines, external runtimes, MCP scopes, Telegram identity |
| [`desktop.md`](desktop.md) | the Electron floating voice window |
| [`android.md`](android.md) | the native Android `/mobile` shell, pairing, notifications, overlay mascot |
| [`docs-site.md`](docs-site.md) | the public Astro + Starlight docs in `docs/` |

## Decisions

[`decisions/`](decisions/) — the durable architectural decisions (ADRs 001–005)
and why the code is shaped this way. They lived in a gitignored directory for
months while five tracked files linked to them; that is why they are here now.

## What is *not* here

**Planning is not a guardrail.** Roadmap, backlog, PRDs, feature dossiers and
the running code-vs-contract survey stay local under `spec/`, which is
gitignored (it has its own `README.md` locally, deliberately not linked from
here). QA runs stay under `qa/`, also gitignored, because raw QA logs are
captures of a live install and can contain credentials.

Nothing in `rules/` may link into `spec/` or `qa/`. Those links are dead in
every fresh clone and on GitHub, which is exactly what happened before.

## Keeping this true

When you change behavior a file here documents, update **both** the deep dive and
the matching rule in the hub, in the same change. When you add a gate, add its
row to [`enforcement.md`](enforcement.md). When you write a rule nothing
enforces, say so in its row rather than leaving the reader to assume.
