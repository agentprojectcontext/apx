# Flows

A Flow is project-owned, event-driven work. A published drawing starts from one trigger: an incoming webhook or a
schedule ([Schedules, Run now and Stop run](#schedules-run-now-and-stop-run)); a legacy definition only takes webhooks.
The core runs deterministic filtering and table operations first; an optional fixed action is admitted only for new, matching, nonempty data.

## Operate a Flow

Open **Flows** in the global sidebar beside Tasks and Resources. It lists all projects; the project menu narrows it. **New flow** opens the full-screen editor (blank or from a starter) and the new Flow starts disabled in the chosen project (the active filter prefills it); editing keeps the saved project fixed and the identifier is derived from the name once. See [Panel editor](#panel-editor) for how a drawing becomes the definition. Direct panel links use `#view=flows`, `#view=flows&scope=<project-id>`, `#view=flows&flow=<flow-id>` (its runs) or `#view=flows&flow=<flow-id>&edit=1` (its editor); chat links use `apx:flows`, `apx:flows/<project-id>`, `apx:flows/<project-id>/<flow-id>` or `apx:flows/<project-id>/<flow-id>/edit`. The project's Routines tab has a shortcut to the same global screen, not an embedded second screen. Choose a stable identifier, name, equality predicates, a destination table key and an action:

- **Table only:** persist matching data without calling a model.
- **Agent:** a fixed agent and fixed prompt. Each event gets its own ordinary chat; incoming data is framed as an untrusted external request, never as the owner's instruction.
- **Routine:** a fixed manual-only routine in the same project. Existing scheduler admission and routine history are reused. A busy routine leaves the event pending until a run ends. The event does not change the routine's prompt or introduce a schedule. The run receives the immutable event ID, Flow ID and data/read snapshot inside an explicitly untrusted `flow_event` envelope; it never needs to guess which version of the latest table row woke it.

A global agent or an agent in the Flow's project is allowed. Cross-project bindings are rejected and checked again before admission. Public payloads cannot select an agent, routine, tool, shell command or identity. Changes require the owner, either directly or through an approved `apx_settings` change. Route token rotation and revocation remain owner-only.

The Flow detail shows, read-only, the drawing the chosen run used with what each step did (graph runs: each step's
recorded times, input, output and reason; legacy runs: the checks up to the one that stopped it, the save and the run
it linked), a log built only from recorded times, and a resizable runs rail (50 per page, **Show older runs** pages back). Selecting the save step shows up to 20 table rows,
read-only; manual row writes are CLI/protocol only (`apx flows write`). It is not a complete export or inspection view. The private `flows.rows` and `flows.events` methods page through the complete table/history with a limit up to 100 and a `nextCursor`; see the export procedure below. Retirement is available through CLI or approved settings changes, not the panel. Equality predicates traverse own properties only; prototype-related paths are rejected. Optional `readKeys` in the protocol/CLI definition snapshots up to 16 fixed table keys before writing the matching event to `tableKey`. The agent receives those snapshots together with the event. No payload text is evaluated as code. Editing the Flow or its table does not rewrite an already accepted event's action or snapshots.

## Public entry

The shared [public ingress](PUBLIC_INGRESS.md) registers only enabled Flow paths. Enable the Flow, then use Settings → Devices → Endpoints to create a separate route credential. Configure the public tunnel independently; enabling a Flow does not publish the private panel or RPC.

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

These are MVP safety limits, not a retention service. At capacity, ingestion refuses new work instead of evicting IDs and risking a duplicate effect. For explicit recovery, disable the Flow, finish/cancel its active runs, stop manual edits, then export and verify the complete table/history before using `apx flows retire <id> confirm-exported` or an approved `apx_settings` retirement with `confirm:true, exported:true`. Without both explicit acknowledgements the private protocol refuses deletion. The export acknowledgement is the caller's assertion; APX cannot verify that an external backup file exists or is readable. Retirement permanently removes its table and events (including pending work), revokes its credential and reserves its old identifier; it cannot reopen the old URL. Existing run chats remain under their ordinary history policy. A new Flow needs a new identifier and credential. Retired identifiers are capped at 10,000. If credential cleanup fails after the data is retired, the route remains absent and the identifier reserved; retry retirement to finish deleting the residual credential. This is deliberate rotation, not automatic replay of the old source backlog.

Credential-named fields (including nested credential objects) and recognizable token shapes are redacted before filtering, table/event persistence or model input. This uses the shared log credential matcher, including APX tokens. Credentials in definitions or event IDs are rejected; use secret references for owner configuration. These rules cannot recognize arbitrary secrets or personally identifying prose without a known field/shape: send only necessary data and do not place credentials in otherwise ordinary fields. Table values and pending snapshots are local durable data. Transport bearer tokens live in the secret store, never in the event envelope.

Empty objects, non-object values, nonmatching events and duplicates do not invoke an action. Idle Flows make no model calls. HTTP requests and deterministic processing still have infrastructure costs. A matching action may use models and tools according to the selected agent/routine's limits.

## Protocol, CLI and tools

All management operations use the private protocol registry: `flows.list`, `flows.set`, `flows.rows`, `flows.write`, `flows.events`, `flows.retry`, `flows.retire`, `flows.try`, and for drawings `flows.graph_get`, `flows.draft_save`, `flows.draft_discard`, `flows.validate`, `flows.outward`, `flows.publish`, `flows.run_get`, `flows.next_runs`, `flows.run_now`, `flows.cancel_run`, `flows.try_graph`. External `chat` tokens cannot call them.

`flows.events` rows carry `run_started_at`, `run_ended_at` and `run_tokens` (fresh tokens, counted as in run usage:
input less cached plus output) from the linked run, `null` until the run has them. They also say which executor
admitted the event (`executor`: `legacy` or `graph`), the graph `revision` it runs, whether that is still what runs
(`current`; a legacy event of a published Flow is `false`), `stopped_at` (legacy: index of the first check the data
did not pass) and, for graph runs, `stopped_by` (the check that said no when no step doing work ran) and `ended_at`.
Graph run states are `pending`, `succeeded`, `failed`, `uncertain`, `cancelled` or `ignored`. Rows also carry `source`
(`webhook`, `schedule` or `owner`), `scheduled_at` (a schedule's due time) and `cancelled_by_owner`.
`flows.list` adds `schedules` (each schedule Flow's cron, `next_at`, null while off, and `skipped`/`skipped_at`: times
skipped since it was turned on because its last run was still going) and `time_zone`. `flows.list` adds
`published`: each published Flow's revision and step kinds in run order. `flows.try {predicates, data}` is a
dry run with the admission rule (a nonempty object that matches every predicate); it reads no table, saves no event,
admits no run and calls no model. Sample data is limited to 32 KiB.

```bash
apx flows list --project p_example
apx flows set '{"id":"inbox","projectId":"p_example","name":"Inbox","enabled":false,"predicates":[{"path":["type"],"equals":"message"}],"tableKey":"latest","readKeys":["config"],"action":{"kind":"none"}}'
apx flows rows inbox
apx flows write inbox config '{"language":"en"}'
apx flows events inbox
apx flows retry inbox source-event-1
apx flows run inbox '{"type":"message"}'   # Run now (owner only; refused inside an agent's command)
apx flows stop inbox owner:<uuid>          # Stop run
# Disable the Flow, finish/cancel active runs and stop manual edits before export.
apx flows export inbox --project p_example > inbox-backup.json
# Verify the saved definition, row count, event count and file readability before deletion.
apx flows retire inbox confirm-exported
```

### Complete reads and export

`flows.rows {flow, limit, cursor?}` sorts keys ascending; its `nextCursor` is the last returned key when more rows
exist. `flows.events {flow, limit, cursor?}` sorts by creation time and event ID descending; its cursor is an object
`{createdAt, eventId}`. Pass `nextCursor` unchanged into the next request and continue until it is `null`, not merely
until a page has fewer than 100 items. Cursors are scoped by the `flow` on each request and never grant access.

The CLI `export` command follows every page and prints one JSON object containing the definition, all table rows,
all event-history metadata, the graph document (`flows.graph_get`) and each graph run step by step (`flows.run_get`;
step values over 4,000 characters are cut and marked `truncated`). It requires the selected Flow to be disabled in the selected project. Exports are
read-only, not cross-request database snapshots: finish/cancel active runs and stop manual edits for a stable backup.
Run chats and private pending-action payload snapshots are not exported or restored by this command. Retirement
still discards pending work; reconcile any work you need before acknowledging deletion. The export is not an import
or a replay mechanism, and does not remove the retained-event cap. To inspect pages manually, the optional CLI cursor
argument is JSON (a quoted string for rows, an object for events).

**Español:** El panel muestra 50 rondas por página y hasta 20 filas de la tabla, solo para leer. Para recuperar todos los datos, desactivá el Flow,
terminá o cancelá sus runs activos y detené las ediciones manuales. `apx flows export <id> --project <proyecto>`
recorre todas las páginas y emite definición, tabla e historial de eventos en JSON. Verificá el archivo y los conteos
antes de usar `retire <id> confirm-exported`; el protocolo exige `confirm:true, exported:true`, pero esa declaración
no prueba que exista un respaldo externo válido. Los cursores se devuelven en `nextCursor`; continuá hasta `null`.
No hay snapshot entre solicitudes, importación ni replay: no se exportan los chats ni los payloads privados de acciones
pendientes, que se descartan al retirar el Flow. El límite de eventos retenidos sigue vigente.

The super-agent discovers the same operations through the existing `apx_settings` tool's `flows` area. No new always-loaded tool, custom script language, polling model, public RPC proxy or duplicate scheduler is introduced.

## Drawn graphs (graph executor)

See [D-167](DECISIONS.md#d-167) for what the executor keeps and what the design left out.

**Documents and revisions.** `flows.graph_get`, `flows.draft_save`, `flows.draft_discard`, `flows.validate` and
`flows.publish` are owner-only. Graphs use `schemaVersion: 2`, at most 32 typed nodes (webhook, schedule, condition,
table_read, table_write, llm, agent, routine, notify, http, vars, js, sql, cmd), 64 edges, four llm nodes, eight
notify + http nodes, eight js + sql + cmd nodes and 128 KiB. Edges out of a condition carry `when`: one of its ways out
(see [Checks with cases…](#checks-with-cases-variables-code-sql-and-commands)). Bindings are `literal`, `event` (a path in the payload) or `node` (a path in an earlier
step's output); no code or expression is evaluated, and `__proto__`/`constructor`/`prototype` are refused. Draft saves
use `expectedVersion` CAS; saving a drawing equal to the publication keeps no draft. `flows.validate` and publication
check the DAG, reachability from the webhook, ancestor bindings, ordered writes to one key, branches only out of
checks, agents and manual routines of the Flow's project, and llm models: one exact `provider/model` (no effort
suffix) of an active provider with its key or sign-in; CLI and ACP engines are refused.

`flows.publish {flow, expectedDraftVersion, expectedPublishedRevision}` validates the draft inside its transaction,
inserts the next revision (rows are never updated; old ones are pruned only when no event or step references them) and
consumes the draft. Publishing does not enable the Flow, rotate credentials, touch rows or wake events. A published
Flow admits new events for its graph; its legacy definition stays as history and `flows.set` changes only its `name`
and `enabled` (turning it on re-checks the published drawing's bindings). There is no return to legacy: retire and
recreate. Legacy pending and failed events keep `executor='legacy'` and drain on the legacy worker, including retry.

**Admission.** The public route authenticates, then `receive` decides in one transaction with the `(flow,event)`
dedup: it pins the revision published now, the payload (redacted, at most 32 KiB after redaction and 32 levels deep,
else `400`), an absolute deadline 10 minutes later and one pending row per step. Empty or non-object data is recorded
`ignored` with no steps. Agent and routine bindings and models are checked again at admission (a broken drawing
refuses events).

**Execution.** One run per Flow at a time, oldest admission first; four Flows advance at once. Steps are chosen by
ordinal id among the ready ones (AND joins: a step waits for every parent; a failed, blocked, uncertain or cancelled
parent blocks it, a skipped parent or the other branch of a check skips it). Database steps (webhook, condition,
table_read, table_write) commit claim, effect and output in one transaction. An llm step claims `reserved`, commits
`dispatched` synchronously right before the single gateway call (`once`: one model, one attempt, no fallback, no token
renewal; no tools; system = the step's prompt, user = `Untrusted input JSON:` + its input) and stores `{text}` only for
a complete answer before the deadline. After sending, a provider refusal fails the step; a timeout, cut connection,
overload or restart leaves it `uncertain`, never re-sent. Agent and routine steps go through `threads.create`,
`threads.send` and `routines.run` with an internal `flowEvent.graph` context (never from a transport); the run is
linked to the step in the transaction that admits it, and the step's output is that run's own final answer. A failed,
canceled, cut or silent run fails the step. The routine admission reuses the legacy one (owner actor inside the core
only, binding re-checked against the pinned revision) and keeps the routine's usual delivery.

**Deadlines and restarts.** Each llm step stops at its `timeoutMs` (≤ 120 s) or the run's deadline. At the deadline,
pending steps are cancelled, a sent model call stays uncertain, waiting runs are asked to stop (repeated on every wake
until they end) and late answers are ignored. Disabling a Flow stops new steps; the deadline keeps running. On start
a `dispatched` step without output becomes `uncertain`; a `reserved` one, or a run step that admitted no run, goes back
to pending. Clock and timers are injected (`runTimers`).

**Records.** Each step keeps `started_at`, `ended_at`, its input and output (redacted, ≤ 32 KiB), a reason code
(`missing_value`, `table_full`, `model_unavailable`, `model_refused`, `model_cut`, `model_uncertain`, `not_started`,
`run_failed`, `run_canceled`, `run_silent`, `deadline`, `value_too_large`) and its run/thread. `flows.run_get {flow,
event}` returns the run's revision graph, whether it is current, its state and times, and each step with input and
output cut to 4,000 characters for display. Logs carry no payload or provider text.

**Retirement.** A Flow retires once disabled, with no run going, no linked run still active and no unpublished draft
(publish or discard it first), after the owner's `confirm-exported`.

**Español:** Un dibujo publicado corre tal cual. Publicar (`flows.publish`, con CAS sobre la versión del borrador y la
revisión publicada) crea una revisión inmutable y consume el borrador; no enciende el Flow ni toca eventos. Cada evento
queda fijado a la revisión con la que entró; los eventos legacy pendientes o fallidos siguen en el ejecutor legacy. Las
condiciones tienen caminos **Sí** y **No**; los pasos reciben lo que llegó o el resultado de un paso anterior. Un paso de
modelo se manda una sola vez, sin herramientas ni reintentos: si después de mandarlo no llega respuesta (tiempo,
corte, reinicio) queda **para revisar** y nunca se reenvía. Cada ronda tiene 10 minutos desde que llega; al vencer se
cancelan los pasos pendientes y se piden detener los trabajos en curso. Un Flow corre un evento por vez, en orden.
`flows.run_get` muestra cada paso con sus tiempos, entrada y salida acotadas y el motivo si no terminó bien. Para
retirar un Flow publicado: apagalo, esperá que terminen sus rondas, publicá o descartá cambios sin publicar y
confirmá la exportación.

## Notify and outgoing HTTP steps

See [D-169](DECISIONS.md#d-169). Both act outside APX, so each goes out at most once and its destination is a fixed
field of the published revision.

**Templates.** `notify.text`, `http.headers[].value` and `http.body` are text with placeholders: `$trigger[.path]` (the
pinned payload), `$steps.<node>[.path]` (an earlier step's output, an ancestor as for bindings) and `$$` for `$`. Each
placeholder parses to an ordinary `event` / `node` binding (at most 32 per template, `__proto__`/`constructor`/
`prototype` refused, `template_invalid` otherwise); a string is inserted as is, anything else as JSON. Nothing is
evaluated. An HTTP body that parses as JSON is filled structurally: a string that is exactly one placeholder takes the
bound value's JSON type, other strings are interpolated, keys stay the owner's (a payload can't add keys or break the
JSON).

**notify** `{channel, to: {kind:"contact", person} | {kind:"room", room}, text, onlyIfContent}`. `channel` is a channel
config id; the person must have an address on it (the owner is a person too), the room must be listed on it; otherwise
`destination_unavailable` at validation, admission and run time. The payload only fills `text` (capped at 4,000
characters). `onlyIfContent`: every placeholder empty (absent, null, blank, `[]`, `{}`) → the step is `skipped`
(`nothing_to_tell`) and its descendants skip; off, an absent field fails `missing_value`. Sending: claim `reserved`, then
one transaction checks the Flow's hourly limit (20 rows in `flow_sends` in the last hour, else `rate_limited`, nothing
sent), records the send and commits `dispatched`; then the channel's outbox takes it (`messageContact` with an exact
channel id, or `postToRoom` by ids, never by name) and the step waits up to 60 s (none when the channel isn't running):
`sent` → succeeded with `{channel, to, owner?, text, delivery}`; refused → `send_failed`; an item no channel has taken
yet is withdrawn (`channel_unavailable`, it never goes out later), also on Stop run and at the deadline; one being sent
or uncertain → `uncertain` (`send_uncertain`). A restart after `dispatched` leaves it uncertain and the outbox may still
deliver it once; it is never sent again by the step. In a contact's chat the message is the owner's words, and that
chat's agent reads it as a user-role note ("Your owner's flow … sent this"), never as its own. Bound values lose link
and mention form (`](` → `] (`, `@` + zero-width space), so a payload can't hide a link or ping someone in the owner's
name; the owner's own text keeps Markdown and mentions. Room posts follow the room's mention rules (no `@everyone`).

**http** `{method: GET|POST|PUT, url, headers ≤ 16, body, timeoutMs 1–30 s}`. The URL is fixed: http(s) only, no
credentials, no `secret://`, no placeholders; a literal private address or a name without a dot is refused
(`url_private`, `url_invalid`, `url_secret`). Headers: token names, no hop-by-hop/`host`/`content-length`/`proxy-*`
(`header_refused`), one line each. Secrets only as `secret://name` in a header's own text (`url_secret`, `body_secret`,
`credential_literal` for a credential-named header without one or a key-shaped literal, `secret_missing` when it does
not resolve for the Flow's project). At run time references are resolved with `resolveIn(ref, project)` inside the
step, only in literal text (a payload that contains `secret://x` is sent as those words); a rendered header with
CR/LF/NUL fails `value_invalid`. The request (`flow-http.ts`): the name is resolved once (5 s), every address must pass
the egress policy (`vmAddressAllowed`: public Internet only; no loopback, private, CGNAT, link-local/metadata, ULA,
mapped, documentation ranges or this host's interfaces, else `destination_refused`), the socket connects to the checked
address through a pinned `lookup` (TLS still verifies the name) and its remote address is checked again before any
byte is written. No redirects are followed (3xx and `location` are the output), no environment proxy, `agent: false`.
A non-GET first counts against the Flow's hourly limit (60, `rate_limited`, nothing sent) and commits `dispatched` on
connect, before writing; after that, no answer is `uncertain`
(`request_uncertain`), before it `request_failed`. A GET never commits `dispatched` (a restart runs it again) and tries
once more after a network error with no answer. Any HTTP answer succeeds, so a check can branch on it: output
`{status, ok, bytes, truncated, content_type?, location?, json? | body? | binary}` — at most 256 KiB read, JSON kept
when it fits 24 KiB, else up to 16 KiB of text; binary (by type, NUL or invalid UTF-8) only said. Resolved secret values
are cut from the answer as sent, URL-encoded and JSON-escaped, in the text and in every string of parsed JSON
(`[secret]`), and the shared redactor runs on every stored value; the recorded input shows
`secret://name`. Logs carry no URL, payload or answer. `APX_FLOW_HTTP_ALLOW` (exact loopback `host:port`, comma-separated,
config-injected) lets a test core reach its own fake service; a real core leaves it empty.

**Consent.** `flows.outward {flow, graph}` lists what a drawing does outside: `sends` (channel label and kind, `to`:
a name or `you`), `calls` (method, host) and `keys` (`send:<channel>:contact:<person>` / `send:<channel>:room:<room>` /
`call:<method>:<url>`, `secret:<name>:<url>` for each secret a call sends). `flows.publish` refuses a draft with notify or http steps (`outward_unconfirmed`) unless its
`outward` equals those keys. The panel asks the owner (**Let this flow act for you?**) when a key is not in the
published revision's list, and publishes with the keys they allowed; Not now keeps the previous revision.

A body whose `Content-Type` says JSON must be valid JSON (`body_not_json`), so values are never pasted into JSON text.

**Known limit.** `apx flows run|stop` refuse when `APX_AGENT` is set, a courtesy check: the core can't tell an agent's
own loopback call from the owner's, as for every owner method; what stops an agent's shell from calling APX's API is
D-106's "APX's own API always asks".

**Schedules that outrun their interval.** A beat that finds a time due while the Flow still has a pending run skips it:
`since` moves on, `flow_schedules.skipped` counts it and `skipped_at` keeps when, logged without payload. Nothing queues
behind a slow run; Run now still queues (FIFO), since the owner asked for it.

**Español:** Avisar manda como vos a una persona o sala fija del dibujo publicado; lo que llega solo llena el texto
(`$trigger.campo`, `$steps.paso.campo`). Un webhook saliente llama a una URL fija; las claves van como
`secret://nombre` en headers. Publicar un dibujo con estos pasos exige mostrar al dueño a dónde manda y qué llama
(`flows.outward`), y `flows.publish` lo verifica. Cada envío y cada pedido que cambia algo sale una vez: si después de
mandarlo no hay respuesta, queda **Para revisar**. Nada a esta computadora ni a redes privadas, ni siquiera por un
nombre que apunte ahí, y sin seguir redirecciones. Un horario cuya ronda anterior sigue corriendo se salta, no se encola.

## Schedules, Run now and Stop run

See [D-168](DECISIONS.md#d-168).

**Schedule trigger.** `{kind: "schedule", cron}`: five fields (minute hour day month weekday, with `*`, lists, ranges
and steps, as routines), evaluated in the owner's time zone (`owner_profile.timezone`, else the machine's). The panel's
presets are crons: `*/5 * * * *`, `0 * * * *`, `30 8 * * 1-5`, `0 3 * * *`. Validation refuses a second trigger, a cron
it can't parse (`schedule_invalid`) and one that fires twice within five minutes (`schedule_too_often`).
`flows.next_runs {cron}` returns the next three times and the zone for the editor.

**Ticks.** The routine scheduler's beat (every 15 s, `officeScheduler` → `flows.tick`) is the only clock; no Flow has a
timer of its own. Each schedule Flow keeps `since` in `flow_schedules`. On a beat, an enabled published schedule Flow
with no row starts counting (nothing owed); one whose next time after `since` has passed admits a single event
`schedule:<due ISO>` with payload `{scheduled_at}` through `receive` (the same transaction and `(flow,event)` dedup as a
POST, pinned to the published revision) and moves `since` to the beat. Times missed while the core was off therefore
run once on start; the event records `scheduled_at` and the panel says it started late. A failed admission (capacity,
broken binding) spends the time too and is logged without payload. Turning a Flow off deletes its row.

**One way in.** Admission compares the source with the pinned revision's trigger: `webhook` needs a webhook trigger
(and a nonempty object, as before), `schedule` a schedule trigger; a schedule Flow has no public route and is left out
of the endpoint list. A legacy definition admits only webhooks.

**Run now.** `flows.run_now {flow, data?}` (owner-only, idempotency key required) needs a published, enabled Flow. The
event is `owner:<uuid>`, `source: "owner"`, admitted by the same path: a schedule Flow gets `{}` whatever was sent, a
webhook Flow gets `data`, redacted and bounded like any payload (an empty body is `ignored`). The panel prefills it with
the trigger step's recorded output of the last run that kept one.

**Stop run.** `flows.cancel_run {flow, event}` (owner-only) ends a pending graph run in one transaction: pending,
starting and waiting steps become `cancelled` (`owner_cancelled`), a model step already `dispatched` becomes
`uncertain` (`cancelled_after_send`, never re-sent); the run ends `uncertain` if any step is, else `cancelled`. The
executor then aborts its model call in flight and asks runs its steps started to stop (as at a deadline). An ended run
returns `{cancelled: false}`. A notify or non-GET HTTP step already `dispatched` is left `uncertain` the same way. The
CLI calls both (`apx flows run|stop`, refused inside an agent's command); they stay out of the super-agent's
`apx_settings` reach, since a run can now send as the owner.

**Try a run.** `flows.try_graph {graph, data}` walks the run's own planner over sample data (≤ 32 KiB): triggers and
checks are evaluated, a branch not taken is skipped, a step that does work is `would_run`, a step whose binding needs an
earlier step's answer is `unknown`, one whose event field is absent is `missing`. It reads no table, writes nothing,
calls no model and starts no run. `flows.validate` takes `project` instead of `flow` to check a drawing not saved yet.

**Español:** Un Flow publicado arranca por webhook o por horario (cron de cinco campos en la zona horaria del dueño).
El único reloj es el pulso del scheduler de rutinas: cada horario vencido entra una sola vez, por la misma admisión que
un POST, con id `schedule:<hora>`; si el core estuvo apagado corre una vez al arrancar, no una por cada hora perdida, y
la ronda dice que arrancó tarde. Apagado no corre ni acumula. Un Flow con horario no tiene dirección pública y uno con
webhook nunca corre por horario. **Correr ahora** (`flows.run_now`) usa la misma admisión, marcada como del dueño: evento
vacío para horario, el cuerpo de ejemplo (dato no confiable) para webhook. **Detener ronda** (`flows.cancel_run`) cancela
los pasos pendientes y deja **para revisar** un paso de modelo ya mandado, sin reenviarlo. **Probar ronda**
(`flows.try_graph`) sigue los caminos sin efectos.

## Panel editor

The editor draws the graph schema above. **Save** stores the drawing as a draft (`flows.draft_save`); for a Flow that
still runs its legacy definition, a drawing with the legacy shape (`shapeOfGraph` in `packages/protocol/src/flow-shape.ts`:
one path, checks, at most one read, one save, then at most one agent or routine) is also saved as that definition with
`flows.set`, as before. When the Flow is on, saving also publishes the drawing; when it is off, turning it on (list or
detail switch) publishes the last saved drawing first. The core's validation runs as the drawing changes and the side
panel says *Runs as drawn* or why it can't run, in the owner's words. A brand-new Flow whose first drawing is not the
legacy shape gets a disabled table-only definition so the drawing has a Flow to belong to. Checks have **Yes** and
**No** outlets; the chip next to each connection in **Goes on to** switches its branch. **Try a run**
(`flows.try_graph`) follows any drawing. A new Flow's drawing is validated against its chosen project before the first
save. The detail draws the revision a run used (legacy runs of a published Flow draw the old
definition) and says **Previous version** when it is not the current one. Coming-soon kinds (SQL, Cmd) are not in the
schema and cannot be added. Notify picks its channel and person or room from the owner's own lists; its message and an
outgoing webhook's body have **Add** buttons for `$trigger.` and each earlier step's result.

## Checks with cases, variables, code, SQL and commands

See [D-170](DECISIONS.md#d-170). None calls a model.

**Checks.** A `condition` has `input` and either `cases` (1–15: `{id, label, match: {kind: "equals", value} |
{kind: "expr", expr}}`) or, as drawings before cases had, `equals` (read as one case `yes`). The first case that holds
names the way out, else `no` ("otherwise"); `no` can't be a case id. Edges out of a check carry `when` = a case id or
`no` (absent means `yes`); `branch_unknown` when it names a way the check doesn't have. A check with cases records
`{case}`; one with `equals` still records `{matched}`, and readers take both. `flows.try_graph` adds `branch`.

**Expressions** (`domain/flow-expr.ts`): `$trigger[.a]`, `$steps.<step>[.a]` or `$steps["my-step"]`, `$vars.<name>`,
literals (numbers, quoted text, `true`, `false`, `null`, `[…]`), `== != < <= > >=`, `&& || !` (and `and or not`),
`+ - * / %`, `? :`, field access `.a` / `[x]`, and `len lower upper trim contains startsWith endsWith number text
round floor ceil abs min max join exists`. Parsed and evaluated over JSON: nothing is run as code, a missing field or
a prototype field is `null`, arithmetic on non-numbers is `null`, text grows to 32 KiB at most, sources to 1,000
characters, nesting to 32. Steps and variables are named, never computed, so validation checks each is an ancestor
(`expr_invalid`, `binding_ancestor`).

**Variables.** `vars: [{name, value: {kind: "literal", value} | {kind: "expr", expr}}]` (1–16; names
`[A-Za-z_][A-Za-z0-9_]*` but `__proto__`/`constructor`/`prototype`) set once per run, in order; a value may read the
ones above it in the same step (`var_order` otherwise). Names are unique across the graph (`var_duplicate`). Later
steps read `$vars.name` in expressions and templates: a binding to the step that sets it, path `[name, …]`. Output:
the object of values.

**JavaScript** (`js {code ≤ 8 KB, input, timeoutMs 100–10,000}`): the body of `function (input, vars)` (`vars`: the
values of ancestor variables steps), strict mode. It runs in a child `node --permission` (it may read only its runner
file; no other files, processes or workers), `--disallow-code-generation-from-strings`, a 64 MB heap, an empty
environment, cwd the temp folder, inside a `vm` context made from `Object.create(null)` with no code from strings or
Wasm, so none of the host (no `require`, `process`, `fetch`, timers) is in reach; Node 24's permission model doesn't
cover the network, so that context is the boundary. Input in and output out are JSON text; the result must not be a
promise, is capped at 64 KiB and bounded as any value. The vm limit stops the code, the parent kills the process 1.5 s
later. Reasons: `code_failed` (with its message in `output.error`), `code_timeout`, `code_too_large`. No effect: a
restart runs it again.

**SQL** (`sql {database, mode: read|write, query, params: [{name, value}], maxRows 1–500, timeoutMs 1–30 s}`): one
statement on a SQLite file inside the Flow's project folder (relative path, no `..`, `~`, `file:` or absolute;
`database_invalid`). At run time the path must not be a link (even a dangling one), its real path must be inside the
folder, never one of APX's own files (inside APX's folder only a project's side folder counts), and a read needs the
file (`database_unavailable`). Parameters are templates bound as `:name` values (a lone placeholder keeps its JSON
type; objects go as JSON text, booleans as 0/1); `?` and a `:name` without a value are refused. It runs in a child
Node (killed at its limit) with `node:sqlite`, which ignores the permission model, so an authorizer decides: reads
(`SELECT`, `READ`, functions, recursive CTEs) on `main` only, and for a write also insert, update, delete and create
table or index; `ATTACH`, `PRAGMA`, triggers, views, temp objects, `load_extension` and other databases are denied,
the first keyword must be `SELECT`/`WITH`/`VALUES` (plus `INSERT`/`UPDATE`/`DELETE`/`REPLACE`/`CREATE` for a write,
since `VACUUM INTO` asks no authorizer), and a second statement is refused. Reads open read only with `query_only`;
`trusted_schema` is off and SQLite's heap is capped at 64 MB. Output: `{columns, rows, count, truncated}` (rows and
24 KiB cut) and, for a write, `{changes, last_id}`. A write commits `dispatched` (and its hourly count, 120) before
the child starts; a statement SQLite refused changed nothing (`query_failed`, failed); stopped, cut or killed after
that it is `write_uncertain`, never run again.

**Commands** (`cmd {command ≤ 4 KB, env: [{name, value}] ≤ 16, stdin ≤ 16 KB, timeoutMs 1 s–2 min,
continueOnError}`): the owner's command through routines' `runStep` in the project's folder (`workDir`; a project
without one gets its side folder), its own process group, stopped as a tree. Its environment is `commandEnv` (no
credentials) minus connection strings, plus the step's variables; names that change how programs run (`PATH`, `HOME`,
`IFS`, `BASH_ENV`, `LD_*`, `DYLD_*`, `NODE_*`, `*PATH`, `*_HOME`, `*OPTIONS`, `*_PROXY`, Windows profile folders…)
are refused (`env_refused`), and a `$trigger`/`$steps`/`$vars` in the command text is refused (`command_placeholder`):
values reach it only as variable values and standard input, never as shell text. Output `{exit, ok, stdout, stderr}`
(each tail-capped at 8,000 characters). A non-zero exit fails the step (`command_failed`, output kept) unless
`continueOnError`, when a later check reads `exit`. It commits `dispatched` with its hourly count (60) right before it
starts; a time limit (`command_timeout`), a signal, **Stop run**, the deadline or a core that dies leave it
`uncertain` (`command_uncertain`), never run again.

**Consent.** `flows.outward` also lists `commands {node, command, folder}` and `writes {node, database}`; their keys
are `cmd:<hash>` and `write:<hash>` of the real folder and everything the step does (command, variables, input,
continue on error; database, query, values), so any change asks again. At most eight `js` + `sql` + `cmd` steps per
graph (`process_limit`). Known limit: moving a project's folder after publishing keeps running there until the next
publish; the core opens a database by path a moment after checking it.

**Español:** La **Condición** prueba sus casos en orden (un campo *es* un valor, o una **fórmula**) y sigue por el primero
que se cumple; si no, por **No** (con más de un caso, **Si no**). Las fórmulas son datos, nunca código. **Variables**
nombra valores (`$vars.nombre`). **JavaScript** corre aparte, sin archivos, internet ni programas, con tiempo y
memoria máximos. **SQL** hace una instrucción en un archivo SQLite del proyecto con valores siempre aparte (`:nombre`);
una escritura se aprueba al publicar y nunca se repite. **Cmd** corre un comando en la carpeta del proyecto; los
valores le llegan solo como variables y entrada. Un comando o una escritura cortados quedan **Para revisar**.

## Verification and rollout

Tests cover authenticated HTTP ingress, private HTTP/WS management, empty/nonmatching/duplicate zero-model behavior, concurrent duplicates, token rotation/revocation, fixed project bindings, manual routine invocation, table read snapshots, bounded queues and restart recovery. Unit and scripted-model integration evidence does not establish a real provider's webhook subscription, public tunnel availability or exactly-once external sends.

The migration is additive. The changed core must restart to load it. Keep the public tunnel off and Flows disabled until their filters, data retention and effect permissions have been reviewed. Rolling back to code without Flow support stops ingestion/dispatch but does not remove its tables or retract external effects.
