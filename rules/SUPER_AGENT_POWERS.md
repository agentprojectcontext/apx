# What the super-agent can do for the owner

The owner's rule ([D-264](DECISIONS.md#d-264)): the super-agent can do, when the owner asks it themselves, whatever
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
| `card` | asks | asks | asks | keys, who reaches the owner, what agents may do, MCP servers, publishing |
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

Still out of reach, for the owner to decide (D-060 keeps models and how far agents act the owner's; each would
reverse a standing decision, so they are not changed here):

| Method | Where | Would need |
|---|---|---|
| `models.set_config` (the router's models) | `settings-reach.ts:84` | the owner lifting D-060 for the router chain; a model with no key or quota breaks every agent on it, so it would need `services.test`-style validation first |
| `threads.model` (a chat's model) | `settings-reach.ts:85` | same as above, per chat |
| `voice.set` (APX's voice, call models) | `settings-reach.ts:147` | same as above |
| `transcription.install` (a local Whisper model) | `settings-reach.ts:145` | the `embeddings.install` treatment: library models only |
| `voice.install`, `profiles.install` | `settings-reach.ts:146`, `:144` | a download from a known library; same treatment |
| `mcp.approveTool`, `mcp.toolMode`, `mcp.trust` | `settings-reach.ts:99`, `:100`, `:91` | `card` like `mcp.set` (they decide what a command on this computer may do) |
| `engines.set_usage` | `settings-reach.ts:43` | low risk: the owner's opt-in to query account limits; reading quotas is `engines.usage` for the super-agent and `plan_usage` for every agent already |
| `tools.grant_set` (narrow a grant to a condition or a date) | `settings-reach.ts:88` | `grant_tool` taking `condition` and `expires_at` |

`apx_settings`, `agent_set`, `apx_flow` and `task_tidy` stay the super-agent's (`policy.ts:102`): another agent asks
it, so a project agent never changes the owner's setup on someone else's word.

## B. Keeps asking even in Auto

`card` (every mode, Total included, never granted for good):

- Keys reaching somewhere: MCP servers (`mcp.set`, D-141), a service change that sends a saved key to another address
  or deletes it (`services.set`, D-264).
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
(`devices.pair_start:116`, `devices.revoke:118`), installing or updating APX and its desktop app (`system.update:127`,
`desktop.install:114`), extensions and their catalogs (`extensions.install:137`, `extensions.remove:138`,
`extensions.catalog_add:141`), the isolated computer (`environments.enable:101`, `environments.bind:102`,
`environments.configure:119`), taking over other CLIs (`setup.take_over_cli:136`), the browser itself
(`browser.control:121`); exposure and tokens — clients and public routes (`clients.create:63`, `clients.revoke:64`,
`public_routes.rotate:65`, `public_routes.revoke:66`, `flows.token_rotate:67`, `flows.path_set:98`), webhooks
(`webhooks.set:83`), how far agents act (`access.set:82`), telemetry (`telemetry.set:103`); deleting en masse or for
good — storage (`storage.clear:104`, `storage.compact:105`, `storage.computers.delete:107`,
`storage.backups.delete:109`), importing a whole setup over this one (`instance.import:111`), deleting chats
(`threads.delete:167`, a panel action); speaking as the owner where it is their own word (`channels.send:199`,
`mail.send:201`, `runs.respond`: agents send through their own tools, behind D-106's cards).

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
