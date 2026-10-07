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

## What every model call carries

<p align="center"><img src="assets/prompt-size.svg" alt="Tokens per model call on a fresh install: APX v2 8.1k, Hermes 13.0k, APX v1 13.2k (Telegram) and 23.6k (web chat), OpenClaw 13.2k" width="760"></p>

Every step of every turn sends the system prompt and the tool definitions again, so their size is paid over and over.
APX v2 sends the least of the agent apps we measured, and a test keeps it under a budget.

| App | System prompt | Tools sent | First call |
|---|---|---|---|
| **APX v2** | 1,260 | 50 tools, 6,859 | **≈ 8,100** |
| Hermes | 3,956 | 24 tools, 9,070 | ≈ 13,000 |
| APX v1 (Telegram, CLI, desktop) | 4,626 | 39 tools, 8,609 | ≈ 13,200 |
| OpenClaw | 9,800 | 14 tools, 3,411 | ≈ 13,200 |
| APX v1 (web chat, API, routines) | 4,115 | 102 tools, 19,441 | ≈ 23,600 |

Tokens (o200k), first call of a fresh install with default settings, measured by running each app's own prompt builder.
MCP servers' tools are found with `mcp_search` instead of being sent one by one, and the prompt stays identical across
calls so the provider's cache keeps it: on a real install with ten MCP servers a one-line answer went from 64k tokens
to 12k, and from the second call about 97% of it comes from the cache. Method, budget and details:
[`rules/PROMPT_SIZE.md`](rules/PROMPT_SIZE.md).

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
pnpm package    # this OS's desktop installer and server bundle, in out/ (also package:mac, :linux, :win)
```

## Run APX on a server (VPS, no desktop)

The core runs on its own; the desktop app and the phone connect to it. On the server, the install script puts the
daemon, the `apx` command and the Node that runs them in `~/.apx/v2/app` and starts it as a service (nothing needs
root; your data stays in `~/.apx/v2`; an APX v1 there is stopped and its `apx` replaced, its files kept to import):

```bash
curl -fsSL https://github.com/agentprojectcontext/apx/releases/latest/download/install.sh | bash
# a bundle you already have:  bash install.sh --file apx-core-<version>-linux-x64.tar.gz
# Windows (PowerShell):       irm https://github.com/agentprojectcontext/apx/releases/latest/download/install.ps1 | iex

apx setup --headless --expose tailscale   # or --expose lan; add --import to bring a local APX v1's projects
```

From then on it updates itself: it checks the releases every few hours, and the panel (here or on a desktop connected
to it) offers the new version. From a checkout instead: `pnpm install` and `alias apx="node $PWD/apps/terminal/src/main.ts"`.

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

### Terminal maintenance and MCP tools

`apx --version` (or `-v`) reports the local CLI build without needing the core. `apx status` shows the running
core, the Home agent's chosen blob, crew, projects, MCP servers, devices and access; `--plain` removes the card
and portrait, while `--json` preserves the health response for scripts. Unknown commands and options print a
short error without a stack trace.

- `apx` (in an interactive terminal) or `apx wizard`: persistent console with Tab completion, history and `/quit`; menu for status, devices, Tailscale, pairing, updates and the panel address.
- `apx upgrade --check`: check the existing updater; `apx upgrade` applies it. Both support `--json`.
- `apx devices [list|pair|revoke <id>]`: list paired devices, issue a pairing code, or revoke one device.
- `apx tailscale status|connect|off`: inspect access, expose APX through an already authenticated Tailscale,
  or return to local access. Uses the same core settings as the panel.
- `apx mcp tools <server> [<tool>] [--json]`: tool descriptions and JSON schemas.
- `apx mcp run <server> <tool> '<json>'`: direct call, raw MCP result as JSON; `-` reads arguments from stdin.
- `apx mcp check <server>`: connection test. `tools`, `run` and `check` accept `--project <id>` and
  `--scope global|project`; `apx mcps` accepts the same subcommands.

Direct MCP calls are owner operations, like the v1 CLI: they do not start an agent turn. Servers must be enabled,
trusted and available in the selected project; outside app tokens and agent actors cannot use this owner door.
`apx mcp` without a subcommand still serves stdio MCP for external clients, and `apx mcp --run` remains the
harness bridge. The core uses one MCP connection and invocation implementation for terminal and agent tools.

The web shares one chat interface, while the core retains normal and code threads. `apx chat "…"` uses Home;
`--agent` selects an agent conversation; `--code` creates a project code thread with its folder and write policy.
Continue any specific thread with `--thread <id>`.

Terminal blob portraits use the web's canonical bodies and eye coordinates, drawn with true-color half-block
glyphs (ASCII shading with visible eyes when colors are disabled). The layout places the blob and its tagline on the left, and a shared APX header, the active option and data in an open
side panel, without boxes or dividers; narrow terminals stack the information. Display identity is cached locally
so offline help and errors retain the Home agent's face. `apx --status` also opens status. `apx daemon` explains
which `apx service` commands to use, without running them. Regenerate after
changing the catalog with `python3 scripts/export-terminal-blobs.py` (Pillow needed only for generation).
