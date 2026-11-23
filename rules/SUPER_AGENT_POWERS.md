# What the super-agent can do for the owner

The owner's rule ([D-266](DECISIONS.md#d-266)): the super-agent can do, when the owner asks it themselves, whatever
the owner could do in the panel or the CLI, and asks only for what is genuinely harmful. In Auto and Total it does not
ask, except for grave or system-touching actions; a failed change leaves the previous setup working.

This audit compares every owner method in `packages/protocol/src/methods.ts` with what the super-agent reaches. The
placement itself is code: `apps/core/src/tools/settings-reach.ts` places each owner-only method that changes something
(`BY_TOOL`, `OWNER_ONLY`, `FLOW_ELSEWHERE`, `NOT_YET`) and `settings.test.ts` fails on one left out; `apx_settings`
(`tools/settings*.ts`), `apx_flow` (`tools/flow-tool.ts`), `agent_set`, `grant_tool`, `routine_set` and the other tools
reach the rest. Reads are not listed: the owner's reads reach the agent through `apx_settings` reads or its own tools.

How a change asks, once the owner asked for it themselves (D-140's gate):

| Level | Manual | Auto / Accept edits | Total | Used for |
|---|---|---|---|---|
| `untrusted` (default) | asks | runs, asks if outside content is in the turn | runs | every settings and team change not below |
| `always` | asks | asks | runs | deleting for good, speaking for the owner, writing other apps' files |
| `card` | asks | asks | asks | keys, who reaches the owner, agents' limits, adding or starting MCP servers, publishing |
| owner only | — | — | — | list C, and what list B keeps out of reach |

## A. Could not do on request, and should

Done in this change:

| Need | Was blocked by | Now |
|---|---|---|
| Set up memory's embedding engine | `embeddings.install` was `MACHINE` in `OWNER_ONLY` (staging `settings-reach.ts:145`); no status read | `apx_settings` `embeddings.local` (read) and `embeddings.install`, library models only (`tools/settings-media.ts`) |
| Switch memory to it | `memory.set_settings` reached it, but switched to `semantic` with no engine (silently words) | refused until an engine is on (`tools/settings-work.ts`, `memory.set_settings.refuse`) |
| Add or change a media / embedding service | `services.set` was `SECRET` (staging `settings-reach.ts:63`) because of `api_key` | `apx_settings` `services.set` without `api_key`; tried with `services.test` before it is saved; moving or deleting a saved key keeps the card |
| Give another agent one of APX's tools without asking | `grant_tool` refused every `apx:` approval (staging `tools/agents.ts:120`, "APX's own tools are the owner's to allow") | `grant_tool` grants APX's tools too, the ordinary grant only, if the granter runs it freely and the target's list allows it |
| Take a grant back | `tools.revoke` was `POWER` (staging `settings-reach.ts:90`) | `grant_tool` `revoke: true`, one agent's grants (the owner's Resources view still takes any grant, a chat's too) |
| Choose which tools another agent may use | `agent_set` had no `tools` (staging `tools/agent-set.ts:107`); `agents.update` takes it | `agent_set` `tools`, checked against `agents.tools` before writing |
| Make what the owner asked without a card in Auto | every `apx_settings` change but a few was `always` (staging `tools/settings.ts:206`), every `agent_set` change too (staging `tools/agent-set.ts:132`) | `untrusted` by default; `always` and `card` only where listed in B |

Opened by the owner afterwards ([D-267](DECISIONS.md#d-267), reversing D-060 for models):

| Need | Was blocked by | Now |
|---|---|---|
| The router's models and the default | `models.set_config` was `POWER` (D-060) | `apx_settings` `models.config` / `models.set_config`; engines must be on with a key (`providers.list`), an empty chain is refused (`tools/settings-models.ts`) |
| One chat's model | `threads.model` was `POWER` | `apx_settings` `threads.model`, same check |
| APX's voice and calls | `voice.set` was `POWER` | `apx_settings` `voice.status` / `voice.set`; a call model is checked, call services must exist |
| Local transcription | `transcription.install` was `MACHINE` | `apx_settings` `transcription.local` / `transcription.install`, APX's whisper.cpp list only |
| An added MCP server's tools | `mcp.approveTool`, `mcp.toolMode` were `POWER` | `apx_settings`, in Auto; `mcp.trust` (start a project's server) keeps the card when it trusts |
| Narrowing a grant | `tools.grant_set` was `POWER` | `grant_tool` `condition` and `expires_at`; a grant held already keeps the owner's narrowing |

Still out of reach and not asked for: `voice.install` and `profiles.install` (`settings-reach.ts` `MACHINE`), and
`engines.set_usage`, the owner's opt-in to query account limits (reading quotas is `engines.usage` for the
super-agent and `plan_usage` for every agent already).

`apx_settings`, `agent_set`, `apx_flow` and `task_tidy` stay the super-agent's (`policy.ts:102`): another agent asks
it, so a project agent never changes the owner's setup on someone else's word.

## B. Keeps asking even in Auto

`card` (every mode, Total included, never granted for good):

- Keys and commands reaching somewhere: MCP servers (`mcp.set`, D-141, `hermes.import`, which adds them, and
  `mcp.trust` starting a project's server), a service change that sends a saved key to another address
  or deletes it (`services.set`, D-266).
- Who reaches the owner and who is the owner: channels (`channels.set`), an address with no person, claiming one, the
  owner role (`contacts.address`, `contacts.claim`, `contacts.set`), contact sources (D-144, D-203), letting a contact
  in (`answer_contact_request`).
- What agents may do: an agent's limits (`agents.set_agent_limits`, `agent_limits`), the isolated computer per agent
  (`environments.permit`), deleting an agent for good (`agents.delete`), migrating agents.
- Publishing: a widget as a public page (`surfaces.share`, `surfaces.public_commit`), activity review.
- Text on every outgoing mail: email signatures.

`always` (Auto asks, Total runs): deleting a task, a routine, a widget or an agent profile for good, a widget's memory,
cancelling a contact's appointment (it tells them), copying APX's skills into other agent apps on this computer,
applying a reviewed agent proposal; plus every tool's own `always` calls (destructive shell commands, APX's own API,
sending as the owner: D-106's list).

Owner only, out of reach (`settings-reach.ts` `OWNER_ONLY`): the machine and its devices — pairing and revoking devices
(`devices.pair_start:112`, `devices.revoke:114`), installing or updating APX and its desktop app (`system.update:123`,
`desktop.install:110`), extensions and their catalogs (`extensions.install:133`, `extensions.remove:134`,
`extensions.catalog_add:137`), the isolated computer (`environments.enable:97`, `environments.bind:98`,
`environments.configure:115`), taking over other CLIs (`setup.take_over_cli:132`), the browser itself
(`browser.control:117`); exposure and tokens — clients and public routes (`clients.create:63`, `clients.revoke:64`,
`public_routes.rotate:65`, `public_routes.revoke:66`, `flows.token_rotate:67`, `flows.path_set:96`), webhooks
(`webhooks.set`), how far agents act (`access.set`), telemetry (`telemetry.set`); deleting en masse or for
good — storage (`storage.clear:100`, `storage.compact:101`, `storage.computers.delete:103`,
`storage.backups.delete:105`), importing a whole setup over this one (`instance.import:107`), deleting chats
(`threads.delete:161`, a panel action); speaking as the owner where it is their own word (`channels.send:193`,
`mail.send:195`, `runs.respond`: agents send through their own tools, behind D-106's cards).

## C. Never

Rule 10 and 11 limits, whatever the mode or the owner's word:

- Typing or storing a secret's value: `secrets.set:44`, `providers.set:62`, `extensions.set_secret:77`,
  `extensions.settings:78`, a service's `api_key` (refused in `services.set`), an MCP server's key pasted as a value
  (refused in `mcp.set`).
- Signing in for the owner: `account.start:45`, `channels.add:52`, `chatgpt.connect:68`, `openrouter.connect:70`,
  `integrations.connect:72`, `integrations.oauth_start:74`, `mcp.signIn:76`.
- Seeing a secret's value: keys never come back from any method; `secret://` references resolve only in the handler.
- Where a stored secret may be typed (`secrets.set_sites:60`, `secrets.move:59`): D-193, the owner marks it; an agent
  asks on its own card.
- Typing passwords, one-time codes or card data in the browser; payments (D-193, rule 10).
