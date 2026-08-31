# Surfaces — every way in, and what it may do

> Deep dive for [`AGENTS.md`](../AGENTS.md). [`repo-layout.md`](repo-layout.md)
> answers *where does a thing live*; this file answers *who can reach it, holding
> what credential, carrying what state*.
>
> Read it before adding a surface, changing auth, or reasoning about whether
> something is exposed. The mistake it exists to prevent: assuming these share a
> lifecycle. **They do not.** They share exactly one thing — the daemon.

## The shape

Everything is a client of one long-running process. Nothing else owns state.

```
                     ┌──────────────────────────────┐
   CLI ─────HTTP────▶│                              │
   web panel ──HTTP─▶│   apx-daemon  :7430          │──▶ ~/.apx/   (all state)
   TUI ──────HTTP───▶│   src/host/daemon/index.js   │──▶ .apc/     (per project)
   desktop ───WS────▶│                              │──▶ engines   (LLM providers)
   android ───HTTPS─▶│   API · 3 WS hubs · plugins  │──▶ runtimes  (coding CLIs)
   MCP client ─stdio─▶ (apx-mcp, own process) ──────┘──▶ MCP servers
   Telegram ──poll───▶ (plugin, inbound)
```

## The table

| Surface | Entry point | Runtime | Auth | State it holds | Boundary |
|---|---|---|---|---|---|
| **daemon** | `src/host/daemon/index.js` (`apx-daemon`) | long-lived, :7430 | token store | **all of it** — `~/.apx/` | HTTP + WS |
| **API** | `host/daemon/api/*.js` — 54 routers, mounted by `buildApi()` | in-process | bearer, any token the store knows | none of its own | every data route under `/api` |
| **web panel** | `src/interfaces/web` (React 19 + Vite) | vite :7431 dev · `dist/` served by the daemon in prod | bearer auto-fetched from `/api/admin/web-token` | SWR cache + per-device `localStorage` prefs | `src/lib/api/*` — nothing calls `fetch` directly |
| **CLI** | `src/interfaces/cli/index.js` (`apx`) | short-lived, auto-starts the daemon | local, master token | none | lazy per-command route modules |
| **TUI** | `src/interfaces/tui` — vendored OpenCode fork | short-lived | HTTP like any client | its own, internal | **zero `#core/` imports** — deliberate island |
| **desktop** | `src/interfaces/desktop` (Electron) | floating window | WS token | window state | `desktop-ws.js` |
| **android** | `src/interfaces/android` (Gradle) + `/mobile` | app / WebView | pairing token | device prefs | HTTPS, usually over a tailnet |
| **MCP server** | `src/interfaces/mcp-server/index.js` (`apx-mcp`) | own process, stdio | inherited from the MCP client | none | stdio JSON-RPC |
| **ACP** | `src/interfaces/acp/index.js` (`apx-acp`) | own process, stdio | inherited | none | stdio |
| **Telegram** | `host/daemon/plugins/telegram/` | inside the daemon | roster keyed by `user_id` → owner / contact / guest | polling offset | **inbound from the internet** |
| **routines** | `core/routines/` + `host/daemon/routines-scheduler.js` | cron inside the daemon | none — it is the system acting alone | run log, per-routine memory | **autonomous execution** |
| **docs site** | `docs/` (Astro + Starlight) | static build | public | none | GitHub Pages |
| **landing** | `landing.html` → published as `/` | static | public | none | GitHub Pages |

## Auth, in one place

There is **one token store** (`host/daemon/token-store.js`, `~/.apx/clients.json`,
mode 0600) holding the master token plus one opaque token per paired client. The
HTTP middleware and `ws-auth.js` both accept *any* token in that store.

Two things follow, and both are easy to get wrong:

- **"Can reach the port" is not "may connect."** The daemon binds `0.0.0.0` when
  the panel is reachable from the LAN or a tailnet. Every WS upgrade is checked
  against the same store as the HTTP routes — that check lives in **one** file
  on purpose (`ws-auth.js`). It started inside `desktop-ws.js` and was pulled out
  when the terminal and event hubs appeared, because a per-channel copy is how
  one channel ends up with the weakest rule.
- **Browsers cannot set headers on a WebSocket handshake**, so `extractWsToken`
  falls back to `?token=`. That is a deliberate exception, not an oversight — do
  not "fix" it, and do not copy the pattern to HTTP.

**Telegram is the one surface where the sender is not the owner.** Unknown
senders are guests with no tools. Anything arriving there is untrusted input
crossing into a privilege boundary — see
[`workflow/04-security-risk-review.md`](workflow/04-security-risk-review.md).

## Adding a surface

1. It talks to `core/` **through the daemon**, not by importing core, unless it
   runs in the same process.
2. It authenticates through the existing token store. Never a second scheme.
3. If it opens a WebSocket, it goes through `isWsUpgradeAuthorized`.
4. If it introduces a new way a turn arrives, that is a **channel** — register it
   in `core/constants/channels.js` and give it a prompt file under
   `core/agent/prompts/channels/`. Never inline per-channel formatting in a
   caller (rule 12).
5. Add it to this table in the same change.
