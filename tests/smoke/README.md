# Smoke: the adapter seam

These run against a **live daemon**, over HTTP, the way the CLI does. Everything else
in `tests/` calls `core/` directly — which is correct per AGENTS.md rule 8, and is also
precisely why a whole class of bug walks straight past the suite.

## The gap, stated plainly

    surface (CLI / web)  →  adapter (api/*.js)  →  core (stores, agent, …)
                          ▲
                          └── nothing tested this

Core is well covered. The surfaces are covered by Playwright for the web. **The CLI's
side of the wire, and the shape contract between adapter and surface, were covered by
nothing.** Eight bugs came out of that gap, all found by hand against a running daemon
(see `docs-internal/secretary/ADAPTER-SEAM-BUGS.md`).

## The rule these tests encode

> If a surface reads a field, something must assert the adapter still sends it.

That is all. They are not integration tests of behaviour — core's tests already do that
far better and faster. They check that the **contract between layers** has not drifted.

## Running

```bash
npm run smoke          # boots its own daemon on a spare port, tears it down
```

Kept under ~30s on purpose. A suite nobody runs protects nothing, so it must stay fast
enough to run without thinking about it. It is **not** in `preflight`: preflight has to
work offline and with no daemon, and these need a live process. It belongs in CI as a
separate job, and in the loop before a release.

## What belongs here

- A route the CLI depends on losing a field it returns.
- A response envelope changing shape (`{meta,data}` vs a bare array).
- A new route colliding with the SPA fallback or escaping auth.
- A path that only resolves once several layers agree.

## What does NOT belong here

- Domain logic. That is a core test — cheaper, faster, and it can assert far more.
- Anything needing a model, a network call, or a real Telegram token.
- Anything that mutates the developer's own `~/.apx`. These use a temp `HOME`.
