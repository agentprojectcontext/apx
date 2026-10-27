# Webhook Flows

A Flow is project-owned, event-driven work. It has no timer or cron schedule. The core runs deterministic filtering and table operations first; an optional fixed action is admitted only for new, matching, nonempty data.

## Operate a Flow

Open Routines → Flows, select a project, and create a disabled Flow. Choose a stable identifier, name, equality predicates, a destination table key and an action:

- **Table only:** persist matching data without calling a model.
- **Agent:** a fixed agent and fixed prompt. Each event gets its own ordinary chat; incoming data is framed as an untrusted external request, never as the owner's instruction.
- **Routine:** a fixed manual-only routine in the same project. Existing scheduler admission and routine history are reused. A busy routine leaves the event pending until a run ends. The event does not change the routine's prompt or introduce a schedule. The run receives the immutable event ID, Flow ID and data/read snapshot inside an explicitly untrusted `flow_event` envelope; it never needs to guess which version of the latest table row woke it.

A global agent or an agent in the Flow's project is allowed. Cross-project bindings are rejected and checked again before admission. Public payloads cannot select an agent, routine, tool, shell command or identity. Changes require the owner, either directly or through an approved `apx_settings` change. Route token rotation and revocation remain owner-only.

The project table can be read and edited in the Flow detail. The MVP panel shows at most 50 rows and 50 history events, without pagination; it is not a complete export or inspection view. The private `flows.rows` and `flows.events` methods accept larger limits within their protocol bounds. Retirement is available through CLI or approved settings changes, not the panel. Equality predicates traverse own properties only; prototype-related paths are rejected. Optional `readKeys` in the protocol/CLI definition snapshots up to 16 fixed table keys before writing the matching event to `tableKey`. The agent receives those snapshots together with the event. No payload text is evaluated as code. Editing the Flow or its table does not rewrite an already accepted event's action or snapshots.

## Public entry

The shared [public ingress](PUBLIC_INGRESS.md) registers only enabled Flow paths. Enable the Flow, then use Settings → Devices → Public endpoints to create a separate route credential. Configure the public tunnel independently; enabling a Flow does not publish the private panel or RPC.

```
POST /flows/<id>
Authorization: Bearer <route token>
Content-Type: application/json

{"id":"stable-source-event-id","data":{"type":"message","text":"Hello"}}
```

The envelope accepts only `id` and `data`. The source must supply a stable event ID, not a new random identifier on every retry. The Flow ID comes from the authenticated URL, never from event data. Gateway authentication happens before the callback and the callback receives no bearer header.

- `202`: the event/filter result and any table write have committed durably. `state` is `ignored`, `written`, `pending` or `duplicate`. It is an acceptance receipt, not proof that the action completed.
- `400`: malformed/oversized data or an invalid envelope; fix the request before retrying.
- `401`: missing, invalid, rotated or revoked credential.
- `404`: unknown or disabled Flow.
- `413`: envelope exceeds 64 KiB; the JSON event value and combined read snapshot are each limited to 32 KiB.
- `415`: not JSON.
- `429`: gateway rate limit or Flow storage/queue capacity; retry with backoff only if the source can preserve its event ID.

The listener also enforces its shared connection/body/deadline limits. See PUBLIC_INGRESS.md. Turning off public access does not erase queued work. Disable the Flow to stop further admission; an action already admitted is an ordinary run and must be canceled through existing run controls if needed.

## Durability and retries

Event ID deduplication is scoped to the Flow. Event admission, fixed action snapshot, deterministic reads and table write share one SQLite transaction. The existing `threads.send` or `routines.run` handler links the admitted run to the event inside its run-admission transaction. A restart drains pending events, but never readmits one already linked to a run. The worker is awakened by receipt, management changes, startup or a run ending; it makes no periodic model call.

History distinguishes deterministic no-op/write, pending work, failed admission and admission with a run ID/state. Follow the run link for completion or a runtime error. Failed admission errors are generic and do not copy webhook/provider bodies into logs. Retry only a failed event with no admitted run; its original binding is preserved. Restoring a removed binding can make a retry possible. Editing the Flow does not silently redirect old pending events.

This is **not exactly-once delivery to external services**. A run can fail after an external send succeeded, or its provider can time out after accepting an operation. Do not blindly repeat the run or mint a new source ID. Reconcile the destination and use the service's own idempotency mechanism where available. Sending/posting still follows APX's normal permission and confirmation policy.

## Resource bounds and data handling

- Up to 1,000 Flow definitions.
- Up to 10,000 retained events across the install (also 10,000 per Flow); dedup IDs are not silently expired.
- Up to 1,000 table rows per Flow and 10,000 across the install; each value is at most 32 KiB.
- At most 32 pending/unfinished events per Flow and 256 across the install at public admission.
- At most 32 predicates with path depth 16 and 16 deterministic reads.

These are MVP safety limits, not a retention service. At capacity, ingestion refuses new work instead of evicting IDs and risking a duplicate effect. For explicit recovery, export any data you need, disable the Flow, finish/cancel its active runs, then use `apx flows retire <id> confirm` or an approved `apx_settings` retirement. Retirement permanently removes its table and events (including pending work), revokes its credential and reserves its old identifier; it cannot reopen the old URL. Existing run chats remain under their ordinary history policy. A new Flow needs a new identifier and credential. Retired identifiers are capped at 10,000. If credential cleanup fails after the data is retired, the route remains absent and the identifier reserved; retry retirement to finish deleting the residual credential. This is deliberate rotation, not automatic replay of the old source backlog.

Credential-named fields (including nested credential objects) and recognizable token shapes are redacted before filtering, table/event persistence or model input. This uses the shared log credential matcher, including APX tokens. Credentials in definitions or event IDs are rejected; use secret references for owner configuration. These rules cannot recognize arbitrary secrets or personally identifying prose without a known field/shape: send only necessary data and do not place credentials in otherwise ordinary fields. Table values and pending snapshots are local durable data. Transport bearer tokens live in the secret store, never in the event envelope.

Empty objects, non-object values, nonmatching events and duplicates do not invoke an action. Idle Flows make no model calls. HTTP requests and deterministic processing still have infrastructure costs. A matching action may use models and tools according to the selected agent/routine's limits.

## Protocol, CLI and tools

All management operations use the private protocol registry: `flows.list`, `flows.set`, `flows.rows`, `flows.write`, `flows.events`, `flows.retry`, `flows.retire`. External `chat` tokens cannot call them.

```bash
apx flows list --project p_example
apx flows set '{"id":"inbox","projectId":"p_example","name":"Inbox","enabled":false,"predicates":[{"path":["type"],"equals":"message"}],"tableKey":"latest","readKeys":["config"],"action":{"kind":"none"}}'
apx flows rows inbox
apx flows write inbox config '{"language":"en"}'
apx flows events inbox
apx flows retry inbox source-event-1
# Disable the Flow and finish/cancel active runs before permanently deleting its data.
apx flows retire inbox confirm
```

The super-agent discovers the same operations through the existing `apx_settings` tool's `flows` area. No new always-loaded tool, custom script language, polling model, public RPC proxy or duplicate scheduler is introduced.

## Verification and rollout

Tests cover authenticated HTTP ingress, private HTTP/WS management, empty/nonmatching/duplicate zero-model behavior, concurrent duplicates, token rotation/revocation, fixed project bindings, manual routine invocation, table read snapshots, bounded queues and restart recovery. Unit and scripted-model integration evidence does not establish a real provider's webhook subscription, public tunnel availability or exactly-once external sends.

The migration is additive. The changed core must restart to load it. Keep the public tunnel off and Flows disabled until their filters, data retention and effect permissions have been reviewed. Rolling back to code without Flow support stops ingestion/dispatch but does not remove its tables or retract external effects.
