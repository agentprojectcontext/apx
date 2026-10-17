---
name: apx-integrations
description: APX's integrations, accounts the owner connects once (Asana, Google Calendar, Gmail, GitHub, Notion, Slack, Sentry, Brave Search, Obsidian) that give agents their tools. Use it when the owner asks to connect, check or disconnect one of those services, or asks why its tools are missing.
---

# Integrations in APX

An integration is an account the owner connects once in [Resources › Integrations](apx:resources/integrations).
Connecting needs the owner's own sign-in or token, so **the owner does it in the app**; you send them the link, say what
to have at hand, and use the tools once it is connected.

| Integration | How it connects | What you get |
|---|---|---|
| Google Calendar | Sign in with Google (the owner's own client from Google Cloud Console) | `calendar_events`, `calendar_free`, `calendar_create_event`, `calendar_update_event` |
| Asana | Personal access token | Native `asana_read`, `asana_write` |
| Gmail | Sign in with Google, as above | `gmail_search`, `gmail_read`, `gmail_draft`, `gmail_send_draft` |
| GitHub | Personal access token | MCP server `github` |
| Notion | Integration token | MCP server `notion` |
| Slack | Bot token and team id | MCP server `slack` |
| Sentry | Access token | MCP server `sentry` |
| Brave Search | API key | MCP server `brave-search` |
| Obsidian | The vault's folder | MCP server `obsidian` |

Linear is listed as coming: it is not available yet.

Asana uses a personal access token from https://app.asana.com/0/my-apps, entered only in the app.
APX validates it before saving `secret://asana-token`; no MCP server is installed.
`asana_read` lists workspaces, projects, tasks and task details (use next_offset for more). Task lists exclude completed tasks unless completed is true; task creation needs an Asana project or workspace.
`asana_write` creates or updates a task and requires owner authorization. An Asana project is its numeric gid, not an APX project id.
The account is shared, with the usual per-project integration switches. These switches control availability, not Asana object permissions.
There is no automatic retry of a write; inspect Asana before repeating a create whose outcome is unknown.

- Google's tools are APX's own and appear only while that account is connected (and, in a project, where it is on).
- The MCP-based integrations add one of the owner's MCP servers named like the integration, with its keys kept as variables. Reach
  their tools with `mcp_search` and `mcp_call`; manage the server like any other (apx-mcps): `apx mcps check github`,
  or `apx mcps off github --project <id>` to keep it out of one project.
- Disconnecting is also the owner's, in the same screen.

## A service that is not in the list

It is an MCP server, not an integration: find the service's MCP server (its docs usually show a JSON block) and add it
with apx-mcps. If it only has an HTTP API, a small extension can wrap it (apx-extensions).

## When its tools are missing

1. `apx mcps list` (for the MCP-based ones): is it there, and in what state?
2. `apx mcps check <name>`: the exact error. An authentication error usually means a token expired or was revoked:
   the owner reconnects it in [Resources › Integrations](apx:resources/integrations).
3. For Asana, check its connection and project switch in Resources › Integrations; a rejected token must be replaced there.
4. For Google, no `calendar_*` or `gmail_*` tools means it is not connected (or is off in this project).

Say what you found and the one step left for the owner. Never ask the owner to paste a token in the chat for an
integration: the app's form keeps it out of the conversation.
