# APX v2

<p align="center"><img src="assets/v1-vs-v2.svg" alt="APX v1 vs v2: one way to do each thing" width="760"></p>

APX is a team of agents that lives on your machine: a secretary that answers you in the app, on your phone or in
your messaging channels; project agents that work with your tools; and a built-in browser they drive and you can take
over at any moment. v2 is a ground-up rewrite of APX with one rule: **one way to do each thing**.

| What | v1 | v2 |
|---|---|---|
| Code paths that run an agent turn | ~23 | **1** — `runTurn()` |
| Ways to talk to an agent | ~15 in the CLI, ~40 overall | **1** — `threads.send`, tuned per agent, thread or channel |
| Ways for one agent to talk to another | 12 | **1** — sessions calling sessions |
| Ways to build the model context | 9 | **1** — one tested context builder |
| Places where a conversation lives | 10 | **1** — thread + run + steps |
| API surface | ~378 endpoints | **~90** typed methods; the CLI only speaks the protocol |

The full survey and the staged plan are in [`plan/archivo/03-relevo-y-plan-motor.md`](plan/archivo/03-relevo-y-plan-motor.md)
(Spanish).

## Layout

```
apps/core          the daemon: owns all state; HTTP + WS protocol, agents, threads, browser, channels
apps/terminal      apx2, the CLI (speaks only the protocol)
apps/web           the panel (served by the core; also the desktop window)
apps/desktop       Electron: the panel plus the embedded browser the agents drive
packages/protocol  the single contract: methods, events and client
packages/ui        the design system
```

## Try it

```bash
pnpm install
pnpm app        # starts the core on 127.0.0.1:7440 and opens the desktop app
pnpm preflight  # privacy check + lint + typecheck + tests
```

Working on the code: [`AGENTS.md`](AGENTS.md).
