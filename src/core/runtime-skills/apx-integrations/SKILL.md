---
name: apx-integrations
description: "APX connectors (integrations/plugins) — Asana, Google Calendar, GitHub, Obsidian, WhatsApp. Load when a connector tool says \"not connected\" / \"read-only\" / \"not authorized\", or the user wants to connect/configure/check a plugin. NOT the same as MCP servers (apx-mcp) or the Telegram channel (apx-telegram). Triggers: 'connect Asana/Calendar/GitHub', 'why can't you see my calendar', 'integration not connected', 'plugins tab', 'read-only calendar'."
---

# apx-integrations

A **connector** (a.k.a. integration / plugin) is a stored, per-project connection to an external service — Asana, Google Calendar, GitHub, Obsidian. It gives the agent's tools live access to that service. It is a **different mechanism** from an MCP server (`apx-mcp`) and from the Telegram channel (`apx-telegram`, a channel, not a plugin).

Catalog source of truth: `src/core/integrations/catalog.js`. Adding a plugin = drop a module in `plugins/` + register it in `PLUGIN_SERVICES` — no route changes.

## The catalog

| slug | name | auth | State |
|---|---|---|---|
| `asana` | Asana | token (PAT) | ✅ implemented |
| `calendar` | Google Calendar | **user OAuth** | ✅ implemented |
| `github` | GitHub | token | ✅ implemented |
| `obsidian` | Obsidian | path (local Vault) | ✅ implemented — has a CLI |
| `whatsapp` | WhatsApp | QR pairing | ⏳ `coming_soon` — do not attempt to connect |

## The one rule: connecting happens OUT OF BAND

**The agent cannot connect a plugin itself.** It cannot paste a token, pick a Vault folder, or complete an OAuth consent screen. Connection is done by the user in the **web panel → Integrations → Plugins** (the generic `PluginConnect` form). Your job is to *guide the user there and then re-check*, never to invent a connect command.

- The **only** connector with a CLI is Obsidian: `apx obsidian …` (a thin client over the same daemon routes — configure/validate/status/sync/remove).
- There is **no** `apx integrations` / `apx plugins connect` command. ⚠️ `apx plugins` is a **different, unrelated** thing (it lists *daemon* plugins at `/api/plugins`) — don't confuse it for connectors.

## Reading the tool errors (this is the main reason you're here)

The connector-backed tools (`calendar_*`, `asana_*`, `github_*`, `obsidian_*`) throw errors written to be relayed verbatim-ish to the user. Recognize them and tell the user the exact next step:

| Error says… | What it means | Tell the user |
|---|---|---|
| "…is not connected. Ask the user to connect it in the web panel → Integrations → Plugins → X" | No usable record for this project | Open the panel, connect X. |
| "The calendar isn't authorized yet." | Configured but no `refresh_token` (OAuth not completed) | Finish the "Connect with Google" step in the panel. |
| "connected read-only … enable write access" | Calendar `write_access: false` | Toggle write access in the panel, then retry. |
| "No Asana workspace selected." | Token valid, workspace not chosen | Pick the workspace in the panel. |

Don't retry the tool in a loop against one of these — the fix is a human action in the panel.

## Scope precedence: project → default(global)

`resolveIntegration()` (`src/core/integrations/store.js`) resolves per project: the project's **own** enabled+active record wins; otherwise the **default** project's record is inherited. So a connector configured once on the `default` project works for every project that hasn't overridden it — the same "global = default project" pattern as MCPs (`apx-mcp`). Records live in the per-project integrations store (like tasks); the API redacts secrets in responses.

## Google Calendar specifics (user OAuth, not a service account)

Calendar acts **as the user** (invites + Google Meet), so it uses OAuth, not a key:

1. User creates a Google Cloud OAuth app and enters `client_id` + `client_secret` in the panel.
2. Panel runs the consent flow (`action: authorize` → Google → redirect back to `/api/integrations/oauth/callback`), which stores a `refresh_token`. APX caches short-lived access tokens from it.
3. `write_access` toggle (default on) = create/edit events, invites, Meet. Off = read-only. `meet` toggle adds a Meet link on create.
4. The calendar is always the account's own `primary` — there is nothing to pick.

Tools: `calendar_list_events`, `calendar_find_slot`, `calendar_create_event` (invitees + Meet), `calendar_update_event`. See `plugins/calendar.js` + `plugins/_google-oauth.js`.

## Daemon API (for reference — the panel and `apx obsidian` use these)

```
GET    /api/projects/:pid/integrations                     # configured, this project (+ scope)
GET    /api/projects/:pid/integrations/catalog             # what's available
GET    /api/projects/:pid/integrations/:slug
POST   /api/projects/:pid/integrations/:slug/configure     # save creds/config
POST   /api/projects/:pid/integrations/:slug/validate      # verify against the provider, persist result
POST   /api/projects/:pid/integrations/:slug/action/:action  # plugin action (asana list workspaces, calendar authorize)
POST   /api/projects/:pid/integrations/:slug/deactivate    # disable, keep creds
DELETE /api/projects/:pid/integrations/:slug               # remove entirely
GET    /api/integrations/oauth/callback                    # OAuth redirect target (signed state, no bearer)
```

`?scope=project|global` selects which store the write lands in.

## Don't

- Don't tell the user to "run a command" to connect a token/OAuth plugin — there's a CLI only for Obsidian. Everything else is the web panel.
- Don't confuse `apx plugins` (daemon plugins list) with connectors. Different subsystem.
- Don't treat a connector as an MCP. If the user wants to *register an MCP server*, that's `apx-mcp`.
- Don't try to connect `whatsapp` — it's `coming_soon` (needs a QR-pairing bridge APX doesn't ship yet).
  This is the CONNECTOR, not the `whatsapp` **channel**: a phone-side bridge already posts incoming
  WhatsApp messages to the super-agent with `channel: "whatsapp"`, and that works. Never answer a
  message that arrived on it with "WhatsApp is not supported yet".
- Don't retry a tool after a "not connected / read-only / not authorized" error — surface the panel step and stop.
