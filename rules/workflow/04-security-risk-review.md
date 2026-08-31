# 04 — Security and risk review

> Run it when the change touches a boundary. Review only the boundaries it
> actually crosses — a manufactured finding costs more than a skipped section.

This repo is a local agent runtime that holds credentials, executes shell
commands, spawns external CLIs, and takes input from the internet. The threat
model is not "an attacker on our servers" — it is **untrusted text reaching a
tool call**.

## The boundaries

**Auth and permissions.** One token store (`token-store.js`), one WS check
(`ws-auth.js`). A change must not introduce a second scheme, and must not let a
WS upgrade skip `isWsUpgradeAuthorized`. Remember the daemon binds `0.0.0.0` when
the panel is LAN- or tailnet-reachable: reaching the port is not authorization.

**Prompt and tool injection — the one that matters most here.**
Model output must never become unchecked authority for a side effect. Ask:

- Can text from a Telegram message, a web page, a file, an MCP tool result or
  another agent's reply reach a shell command, a file path, or a send?
- Is a path from user input interpolated into a command string? This has already
  happened: a `cat "${path}"` built from a user-controlled path, where `"` or
  `$(…)` executes.
- Does an untrusted string cross a *privilege* boundary — a guest Telegram
  sender reaching a tool an owner should hold?

**Shell and filesystem.** Argument arrays, never string interpolation. Paths
resolved and bounded — a project agent must not read another project's files.
Writes go through the atomic JSON helpers, and **never into a committed path**
without a human reading it first.

**Network / SSRF.** A URL from config or from model output, fetched by the
daemon, is an SSRF primitive. Timeouts on every outbound call.

**Secrets and logging.** `apx config show --effective` and `apx status` print
engine API keys and the Telegram bot token. Does the change log a config object,
a tool argument, or a request body? Tool arguments ride into the ledger and the
live feed, and the masker only knows global config and MCP secrets — a
project-scoped token (an Asana PAT, say) passed as a tool argument is **not**
masked today. Never commit captured output.

**Duplicate side effects and idempotency.** The de-duplication that stops a
Telegram message being sent three times keys off tool **names** — renaming a
tool without updating `names.js` silently disables a safety check. On retry:
does the operation run twice? Does a routine re-deliver?

**Resource exhaustion.** Unbounded loops in the agent, unbounded fan-out, a
sync read on a request path, an unbounded file read into memory.

**Dependencies.** A new dependency is a new supply chain. Rule: state why the
platform and the existing primitives are insufficient. Optional dependencies
must degrade, not crash.

## Output

Only real findings, each with the boundary it crosses and a concrete exploit
path or failure scenario. If a boundary is not touched, say so and move on.
