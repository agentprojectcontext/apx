# Webhook Flows

A Flow is project-owned, event-driven work. It has no timer or cron schedule. The core runs deterministic filtering and table operations first; an optional fixed action is admitted only for new, matching, nonempty data.

## Operate a Flow

Open **Flows** in the global sidebar beside Tasks and Resources. It lists all projects; the project menu narrows it. **New flow** opens the full-screen editor (blank or from a starter) and the new Flow starts disabled in the chosen project (the active filter prefills it); editing keeps the saved project fixed and the identifier is derived from the name once. See [Panel editor](#panel-editor) for how a drawing becomes the definition. Direct panel links use `#view=flows` or `#view=flows&scope=<project-id>`; chat links use `apx:flows` or `apx:flows/<project-id>`. The project's Routines tab has a shortcut to the same global screen, not an embedded second screen. Choose a stable identifier, name, equality predicates, a destination table key and an action:

- **Table only:** persist matching data without calling a model.
- **Agent:** a fixed agent and fixed prompt. Each event gets its own ordinary chat; incoming data is framed as an untrusted external request, never as the owner's instruction.
- **Routine:** a fixed manual-only routine in the same project. Existing scheduler admission and routine history are reused. A busy routine leaves the event pending until a run ends. The event does not change the routine's prompt or introduce a schedule. The run receives the immutable event ID, Flow ID and data/read snapshot inside an explicitly untrusted `flow_event` envelope; it never needs to guess which version of the latest table row woke it.

A global agent or an agent in the Flow's project is allowed. Cross-project bindings are rejected and checked again before admission. Public payloads cannot select an agent, routine, tool, shell command or identity. Changes require the owner, either directly or through an approved `apx_settings` change. Route token rotation and revocation remain owner-only.

The Flow detail shows the current definition as a read-only canvas with what each step did in the chosen run, the
step's input/output and a log built only from recorded times (event arrival, run start and end, fresh run tokens), and
a resizable runs rail (50 per page, **Show older runs** pages back). Selecting the save step shows up to 20 table rows,
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

All management operations use the private protocol registry: `flows.list`, `flows.set`, `flows.rows`, `flows.write`, `flows.events`, `flows.retry`, `flows.retire`, `flows.try`. External `chat` tokens cannot call them.

`flows.events` rows carry `run_started_at`, `run_ended_at` and `run_tokens` (fresh tokens, counted as in run usage:
input less cached plus output) from the linked run, `null` until the run has them. `flows.try {predicates, data}` is a
dry run with the admission rule (a nonempty object that matches every predicate); it reads no table, saves no event,
admits no run and calls no model. Sample data is limited to 32 KiB.

```bash
apx flows list --project p_example
apx flows set '{"id":"inbox","projectId":"p_example","name":"Inbox","enabled":false,"predicates":[{"path":["type"],"equals":"message"}],"tableKey":"latest","readKeys":["config"],"action":{"kind":"none"}}'
apx flows rows inbox
apx flows write inbox config '{"language":"en"}'
apx flows events inbox
apx flows retry inbox source-event-1
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

The CLI `export` command follows every page and prints one JSON object containing the definition, all table rows and
all event-history metadata. It requires the selected Flow to be disabled in the selected project. Exports are
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

## Versioned graph foundation (not executable)

The private owner-only protocol supports `flows.graph_get`, `flows.draft_save`, `flows.draft_discard` and
`flows.validate` for an existing Flow. Graphs use `schemaVersion: 2`, bounded typed nodes, explicit edges and
structured event/output bindings; no code or expressions are evaluated. Draft saves require `expectedVersion`
(`null` for the first save). Stale writes fail instead of overwriting another editor. Validation checks DAGs,
connectivity, ancestor output references and project action bindings. Writes to the same table key require an
explicit ancestor dependency; an incidental node identifier or canvas position is not a write-order guarantee.
Isolated pure graph semantics tests cover ordinal topological order, AND joins, bounded JSON bindings and condition
results. Those helpers do not admit events, persist execution state or run a worker; they do not unlock publication.
Structurally valid but disconnected drafts
can be saved for further editing. A valid structural result does not mean the graph is executable.
Credential-pattern checks are not complete secret detection or redaction: never put credentials in graph labels,
prompts or literal values; use the existing dedicated credential configuration.

**This is persistence and validation infrastructure, not a working graph executor.** The graph document reports
`executionAvailable: false`; LLM, agent and routine graph nodes do not run. `flows.publish` remains registered but
is unconditionally blocked in the domain and over both HTTP and WS until execution, recovery and complete graph
export are supported. The error is a non-retryable conflict with `detail.reason: graph_execution_unavailable`.
This applies to all graphs, including webhook-only graphs and graphs without LLM nodes; disabling a Flow, draining
its queue or passing structural validation does not unlock publication. Rejection does not change the draft,
published revision, legacy definition, public credential, rows, event snapshots or admitted runs.
LLM nodes can be saved in drafts, but validation additionally reports `llm_execution_unavailable` for every model,
including configured providers and CLI references. No model is certified as available until the graph executor and
provider validation exist; this does not establish consent to send particular data or a successful model call.

Graphs are limited to 32 nodes, 64 edges, four LLM nodes and 128 KiB. The storage foundation has revision,
event and checkpoint tables plus internal admission and bounded retention primitives; none is a graph executor.
Retention is tested only as an isolated storage primitive: it reserves space below 100 revisions per Flow and
10,000 globally, never pruning a current publication or a revision referenced by an event/checkpoint. It is not
called by the blocked publication method, and no public operation creates graph revisions or graph admissions.
Stored graph snapshots, if present, remain isolated from the legacy dispatcher and cannot be discarded as if they
were legacy-only data. No recovery worker or external effect retry exists for graph checkpoints. Graph-shaped
configuration must not be treated as a runnable workflow.

Existing definitions, table rows, pending action/read snapshots and admitted runs stay on the legacy executor.
Adding these tables does not convert or enqueue old events. Disabling a Flow still pauses its legacy pending
admission; already admitted runs keep their ordinary lifecycle. A graph draft or a rejected publication does not
prevent legacy edits, activation, explicit retry, deduplication or normal dispatch, including after restart. Resume
legacy work using its existing controls; graph publication remains blocked even after the queue has drained.
The legacy export command does not yet include graph drafts, revisions or checkpoints; do not retire a graph Flow
assuming that legacy export is a complete graph backup. Retirement is blocked for published graphs and undiscarded
drafts until complete graph export is supported.

To undo an accidental draft on a never-published Flow, use owner-only `flows.draft_discard` with `flow`, the exact
`expectedVersion` and `confirm:true`. This deliberately deletes the draft, not the legacy definition, rows, events
or public credential; keep any graph you need before confirming. It does not activate or retire the Flow. Published
graphs cannot be discarded this way. A discarded draft leaves a monotonically increasing version token even though
`draft` is `null`; a subsequent save must use that returned `draftVersion`, not `null`. This prevents stale editors
from deleting or recreating a newer draft, including after restart. The discarded marker no longer blocks ordinary
legacy retirement, which still requires disablement, exported confirmation and no active runs.

**Español:** La validación exige una dependencia explícita de ancestro entre escrituras a la misma clave de tabla;
el identificador del nodo o su posición en el canvas no garantizan el orden de escritura. Las pruebas aisladas de
semántica pura cubren orden topológico ordinal, joins AND, bindings JSON acotados y resultados de condiciones.
Esos helpers no admiten eventos, persisten ejecuciones ni integran un worker; no habilitan publicación.
La base de grafos versionados todavía no ejecuta nodos: devuelve `executionAvailable: false`.
Guardar un borrador no activa ni publica. `flows.publish` queda registrado pero bloqueado incondicionalmente en el
dominio y por HTTP/WS hasta contar con ejecución, recuperación y exportación completa del grafo. Devuelve conflicto
no reintentable con `detail.reason: graph_execution_unavailable`. Incluye todos los grafos, con o sin LLM; ni
validar, desactivar el Flow ni drenar su cola desbloquea la publicación. El rechazo conserva borrador, publicación,
definición legacy, credencial pública, filas, snapshots de eventos y runs admitidos. Un resultado estructural válido
no certifica ejecución. Los nodos LLM se pueden guardar, pero la validación informa además
`llm_execution_unavailable` para cualquier modelo hasta contar con ejecutor y validación del proveedor; no certifica
disponibilidad ni llamadas reales. Guardar o intentar publicar no bloquea edición, activación, retry explícito,
deduplicación ni ejecución legacy, incluso tras reiniciar; usá sus controles habituales para reanudarla. La migración
conserva tablas, eventos y acciones legacy sin reproducirlos. La exportación legacy todavía no incluye borradores,
revisiones ni checkpoints del grafo; no la uses como respaldo completo para retirarlo. El retiro queda bloqueado
si existe un grafo publicado o un borrador sin descartar.
Para deshacer un borrador accidental nunca publicado, `flows.draft_discard` exige `flow`, `expectedVersion` exacto
y `confirm:true`. El descarte elimina deliberadamente ese borrador, no la definición legacy, filas, eventos ni
credencial pública; guardá antes cualquier grafo que necesites. No activa ni retira el Flow y no permite descartar
publicaciones. Devuelve `draft:null` con un `draftVersion` creciente que debés usar en el siguiente guardado, incluso
tras reiniciar: no vuelvas a `null`. Tras descartar, el marcador ya no bloquea el retiro legacy con sus controles
habituales. Las tablas de revisiones/eventos/checkpoints y las primitivas internas de admisión/retención son
infraestructura de almacenamiento, no un ejecutor. La retención se prueba de forma aislada: reserva lugar bajo
100 revisiones por Flow y 10.000 globales, sin podar publicaciones actuales ni referencias de eventos/checkpoints.
No la llama el método de publicación bloqueado y ninguna operación pública crea revisiones ni admisiones de grafo.
Los snapshots de grafo existentes, si los hubiera, siguen separados del dispatcher legacy. Los controles por
patrones no detectan ni redactan todos los secretos: no pongas credenciales en etiquetas, prompts o valores del
grafo; usá la configuración dedicada.

## Panel editor

The editor draws the graph schema above and decides what to save with `shapeOfGraph` in
`packages/protocol/src/flow-shape.ts`. A graph the current executor runs is one path from the single webhook in this
order: checks (event field equals a literal), at most one table read, exactly one table write of the whole event, then
at most one agent (whole event as input) or routine. Such a graph is saved with `flows.set` as the definition it stands
for, then with `flows.draft_save` to keep its step names and positions; the detail shows that draft only while it
still matches the definition (`sameShape`), otherwise it draws the definition. Any other graph is saved only as a
draft and the screen names the step that keeps it from running; the definition stays as it was. A brand-new Flow whose
first save is draft-only gets a disabled table-only definition so the draft has a Flow to belong to. Nothing runs on
save, `flows.publish` is never called, and coming-soon kinds (schedule, SQL, outgoing webhook, Cmd, notify) are not in
the schema and cannot be added. Because editor saves keep a draft, retiring such a Flow first needs
`flows.draft_discard` (see above) until complete graph export exists.

## Verification and rollout

Tests cover authenticated HTTP ingress, private HTTP/WS management, empty/nonmatching/duplicate zero-model behavior, concurrent duplicates, token rotation/revocation, fixed project bindings, manual routine invocation, table read snapshots, bounded queues and restart recovery. Unit and scripted-model integration evidence does not establish a real provider's webhook subscription, public tunnel availability or exactly-once external sends.

The migration is additive. The changed core must restart to load it. Keep the public tunnel off and Flows disabled until their filters, data retention and effect permissions have been reviewed. Rolling back to code without Flow support stops ingestion/dispatch but does not remove its tables or retract external effects.
