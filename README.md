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
apps/terminal      apx, the CLI (speaks only the protocol)
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

## Run APX on a server (VPS, no desktop)

The core runs on its own; the desktop app and the phone connect to it. On the server (Node 24 and a checkout or the
packaged `apps/` folder):

```bash
pnpm install
alias apx="node $PWD/apps/terminal/src/main.ts"

apx setup --headless --expose tailscale   # or --expose lan; add --import to bring a local APX v1's projects
```

`setup --headless` does, in order, what you can also run by hand:

```bash
apx service install      # systemd user unit (Linux), launchd agent (macOS) or a login entry (Windows)
sudo loginctl enable-linger "$USER"        # Linux: keep the service running after you log out
apx expose tailscale     # or: apx expose lan
apx service restart      # the core reads <home>/core.env when it starts
apx pair                 # a one-time code, the addresses and an apx://pair link
```

- `apx expose tailscale` keeps the core on `127.0.0.1` and publishes it with `tailscale serve` at
  `https://<machine>.<tailnet>.ts.net`, reachable only from your tailnet. Tailscale must be installed and logged in.
- `apx expose lan` makes the core listen on every address (`APX_HOST=0.0.0.0`), e.g. `http://192.168.1.20:7440`.
  Use it only on a network you trust, or behind your own TLS proxy.
- Both create a token for the core if it has none; it lives in `<home>/core.env` (mode 600, home `~/.apx/v2` unless
  `APX_HOME` says otherwise). The terminal and the desktop app on the same machine read it from there.
- `apx expose status` shows what is in effect; `apx expose off` goes back to this computer only (the token stays).
- `apx service status` / `uninstall` check or remove the service.

To connect a phone or another computer, run `apx pair` on the server and, in the APX app, paste the `apx://pair` link
or enter one of the printed addresses (the Tailscale URL or the LAN address) and the code. The code is valid for a few
minutes and works once; each device gets its own token.

Working on the code: [`AGENTS.md`](AGENTS.md).
