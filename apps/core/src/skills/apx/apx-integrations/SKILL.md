---
name: apx-integrations
description: APX's integrations, accounts the owner connects once (Google, Asana, GitHub, Notion, Slack, Linear, Jira, Home Assistant and about fifty more) that give agents their tools. Use it when the owner asks to connect, check or disconnect one of those services, or asks why its tools are missing.
---

# Integrations in APX

An integration is an account the owner connects once in [the Marketplace](apx:marketplace).
Connecting needs the owner's own sign-in or token, so **the owner does it in the app**; you send them the link, say what
to have at hand, and use the tools once it is connected.

| Integration | How it connects | What you get |
|---|---|---|
| Google Calendar | Sign in with Google (APX's own sign-in; no Google Cloud setup) | `calendar_events`, `calendar_free`, `calendar_create_event`, `calendar_update_event`, `calendar_cancel_event` |
| Asana | Personal access token | Native `asana_read`, `asana_write` |
| Gmail | Sign in with Google, as above | `gmail_send` with APX's sign-in; `gmail_search`, `gmail_read`, `gmail_draft`, `gmail_send_draft` with the owner's own OAuth client |
| Google Drive, Docs and Sheets | Sign in with Google, as above | `drive_search`, `drive_read`, `drive_write_doc`, `drive_share`, `sheets_tabs`, `sheets_read`, `sheets_create`, `sheets_write` (APX's sign-in reaches app-accessible files; the owner's own client can read the whole Drive, but writing stays limited to app-accessible files) |
| GitHub | Personal access token | MCP server `github` |
| Notion | Integration token | MCP server `notion` |
| Slack | Bot token | MCP server `slack` |
| Sentry | Access token | MCP server `sentry` |
| Brave Search | API key | MCP server `brave-search` |
| Obsidian | The vault's folder | MCP server `obsidian` |
| Home Assistant, n8n | Their address and a token | MCP server `home-assistant`, `n8n` |
| Linear, Jira and Confluence (`atlassian`), GitLab, Vercel, Supabase, Stripe, Todoist, Airtable, Figma, Cloudflare, Netlify, Neon, ClickUp, monday.com, Canva, Miro, Dropbox, Calendly, Datadog, Grafana, PayPal, WordPress.com, Hugging Face and more | Nothing to type: the owner signs in in their browser | MCP server named like it (`linear`, `stripe`…) |
| Context7, DeepWiki, Wolfram, AWS Knowledge, Microsoft Learn | Nothing: no account | MCP server named like it |

Microsoft 365 and Box are listed as coming: not available yet. An app the owner signs in to waits on that sign-in
until they finish it: its server shows `needs-sign-in`, and the integration's screen has **Sign in** to open the page
again.

Docs already use `drive_read` and `drive_write_doc`: the latter creates a Doc or replaces its entire plain text, not a rich-text or incremental editor. Do not claim structured Docs API editing.
For Sheets, connect Drive, find the spreadsheet with `drive_search` `kind: "sheet"`, then use `sheets_tabs` to discover exact tab names and `sheets_read` with an explicit range such as `'Budget 2026'!A1:D20`. CSV export through `drive_read` covers only a worksheet, not the full workbook. Ranges are limited to 200 rows, 50 columns and 2,000 cells, with 20,000 characters of returned values; chunk larger reads. `sheets_create` creates an empty workbook; `sheets_write` replaces only supplied cells with `confirm: always` under the existing approval policy: normal mode asks, while Total or an explicit agent rule may preauthorize it. This is not an unconditional approval boundary. Values use RAW mode, so a string starting with `=` remains text, not an evaluated formula. Empty strings clear cells; omitted values do not. No append, formula evaluation, formatting, automatic sharing or background sync is provided. Writes require Google's existing app-file grant; the owner's own client does not grant arbitrary full-Drive edits. A custom OAuth project must enable the Google Sheets API. After an uncertain create/write, inspect before repeating it; no automatic write retry occurs except Google's existing token-refresh handling of a rejected 401.

Asana uses a personal access token from https://app.asana.com/0/my-apps, entered only in the app.
APX validates it before saving `secret://asana-token`; no MCP server is installed.
`asana_read` lists workspaces, projects, tasks and task details (use next_offset for more). Task lists exclude completed tasks unless completed is true; task creation needs an Asana project or workspace.
`asana_write` creates or updates a task and requires owner authorization. An Asana project is its numeric gid, not an APX project id.
The account is shared, with the usual per-project integration switches. These switches control availability, not Asana object permissions.
There is no automatic retry of a write; inspect Asana before repeating a create whose outcome is unknown.

- Google's tools are APX's own and appear only while that account is connected (and, in a project, where it is on).
  Each part (Calendar, Gmail, Drive) connects on its own: suggest only the one the owner needs. Calendar works fully
  with APX's sign-in; reading Gmail and all of Drive needs the owner's own OAuth client, which the dialog walks them
  through creating (about 5 minutes) and can connect all three parts in one sign-in.
- Scheduling with someone: look at `calendar_free`, ask the person (or the owner) for the missing email and a time that
  suits them, then create the event with `meet: true` for a call. People added later go in with
  `calendar_update_event` `add_attendees`; the event keeps its id, so change it instead of making a new one.
- The MCP-based integrations add one of the owner's MCP servers named like the integration, with its keys kept as variables. Reach
  their tools with `tool_search` and `tool_run`; manage the server like any other (apx-mcps): `apx mcps check github`,
  or `apx mcps off github --project <id>` to keep it out of one project.
- Disconnecting is also the owner's, in the same screen.

## A service that is not in the list

It is an MCP server, not an integration: find the service's MCP server (its docs usually show a JSON block) and add it
with apx-mcps. If it only has an HTTP API, a small extension can wrap it (apx-extensions).

## When its tools are missing

1. `apx mcps list` (for the MCP-based ones): is it there, and in what state?
2. `apx mcps check <name>`: the exact error. An authentication error usually means a token expired or was revoked:
   the owner reconnects it in [the Marketplace](apx:marketplace).
3. For Asana, check its connection and project switch in the Marketplace; a rejected token must be replaced there.
4. For Google, no `calendar_*`, `gmail_*`, `drive_*` or `sheets_*` tools means that part is not connected (or is off
   in this project). "Sign in again" in its dialog fixes a revoked or expired access.

Say what you found and the one step left for the owner. Never ask the owner to paste a token in the chat for an
integration: the app's form keeps it out of the conversation.
