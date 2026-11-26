# Extension observations and delivery

An extension can declare named `events` and an optional `monitor` in its manifest. Installation runs nothing.
Connecting it approves its code but does **not** enable notices. An owner separately chooses a personal chat and
quiet hours through `extensions.events_set` (or the corresponding owner-confirmed `apx_settings` operation).
Contact, room, task and project threads are not destinations in this version.

```json
{
  "events": [{ "name": "cycle_finished", "description": "The observed cycle finished" }],
  "monitor": { "server": "status", "tool": "observe", "every_seconds": 300, "local_state": true }
}
```

`server` names one of the extension's own declared MCP servers. Event names are unique and bounded (at most 20).
The monitor is optional; an owner-authenticated local CLI can also submit an observation:

```bash
apx events get northwind
apx events set northwind enabled=true thread=home quiet_start=1320 quiet_end=480 time_zone=UTC
apx events emit northwind/cycle_finished cycle-42 '{"program":"Rinse"}'
```

Times are minutes since local midnight. Equal quiet endpoints mean no silence window. Quiet hours defer admission,
not observation. They do not suppress the source's polling. An admitted agent turn follows APX's existing attention
and channel notification rules; receiving an observation does not itself authorize sending a message or controlling
a device. Gmail keeps its existing polling and delivery, without an extra copy of its notifications.

## Monitor contract

The office clock checks due monitors every 15 seconds. A declaration chooses an interval from 30 to 3600 seconds;
it is the idle interval, not a real-time guarantee. A response can request `next_poll_seconds` between 30 seconds
and that interval for closer observation during activity. A read may take longer and failures back off to at least a minute.
There is at most one in-flight poll per extension. Calls use the existing bounded MCP manager and subprocess
lifecycle; there is no extra daemon, socket or model call per poll.

The declared observation tool is reserved: ordinary agent discovery and `mcp.call` cannot invoke it, even with
a server-wide grant or Total autonomy. Only the core monitor uses that capability. The core passes
`{ "session": "<configuration revision>", "acknowledged": [{ "event": "cycle_finished", "id": "cycle-41" }] }`.
The tool must accept both fields. Acknowledgments refer to durably persisted core receipts, not external actions;
there are at most ten. A lost acknowledgment is retried after a replay, including after a core restart.
The tool returns a bounded object of this shape, as MCP text JSON:

```json
{
  "events": [{ "event": "cycle_finished", "id": "cycle-42", "data": { "program": "Rinse" } }]
}
```

An empty array means no event. A failed read must return an MCP tool error, **not** a completion or an empty success.
The entire batch is parsed before admitting its events (at most 10). The text limit is 32 KB; data contains at most
30 flat primitive fields, each string at most 1000 characters. Event ids are bounded to 160 characters. The source
must avoid account identifiers, device addresses, serial numbers, tokens and credentials; core schema checks are
not a semantic privacy filter.

The tool must declare `readOnlyHint: true`, or, for a manifest that explicitly sets `local_state: true`,
`destructiveHint: false`. The latter permits its own local observation cursor/outbox, **not** device controls.
These declarations are author promises, not an OS sandbox. Connecting an MCP extension already trusts its code.
A dedicated review of the monitor's implementation is still needed. The observer must never select an arbitrary
control tool based on external data or launch a program as a completion side effect.

For the monitor's server, the core supplies `APX_EXTENSION_DATA_DIR` outside its fingerprinted package and creates
that directory before the first poll. It also pins `APX_EXTENSION_MONITOR_SESSION`; a source must reject a different
argument before changing managed state. The directory survives updates; no owner-entered path/key is needed.
Persist a cursor and bounded queue of individual undelivered events with stable ids, replaying the oldest batch
until the core acknowledges their persisted receipts. Do not consume an event just before returning it or replace
one undelivered completion with the next. A crash between source commit and receipt persistence must retain it.
A full source can return old events plus `warning: "source_storage_full"` to drain backlog while reporting pressure;
its documented bounds must explain whether new observations can be missed. Sources use the pinned revision to
reset arming after configuration changes; a restart alone keeps it. Uninstall removes managed state and cascades
core receipts/configuration. A fresh install cannot resume a prior observation session.

## Durability and revocation

SQLite receipts deduplicate `(extension, installation generation, event name, source id)`, independently of HTTP
idempotency. A configuration revision binds pending receipts and in-flight polls to their original target. Admission
uses the canonical `threads.send` router; the receipt and resulting run are linked in the same transaction. A
restart retries pending receipts; it does not recreate an already admitted run. This is not an exactly-once claim
about model calls or external side effects. Model failure/recovery follows the existing run lifecycle.

Payloads enter as an external-client origin, never as the owner's words. Agents cannot invent observations through
the emission method. The owner CLI uses normal authenticated protocol access; no general APX token is passed to
the extension. There is no public webhook, anonymous emission method or new transport exemption.

Turning the extension off disables its notice configuration and cancels pending receipts atomically. Turning it
back on alone does not resume notices. Updating/changing its files invalidates the approved generation; the owner
must configure notices again. Editing notice settings cancels old pending delivery and invalidates in-flight results.
No such cancellation retracts a run that was already admitted. Disabling notice settings interrupts its active MCP
poll; that may also interrupt a simultaneous manual call to that same server. Shutdown waits for monitor teardown
before closing storage.

There are 60 new receipts per minute and 10,000 retained receipts per installation. Duplicates do not spend the rate
allowance. Terminal receipts older than 24 hours are automatically compacted on emission and scheduler ticks;
pending receipts are never evicted by that compaction and expire after seven days. Storage refuses new events
while the bounded window is full, then recovers capacity when terminal history ages out. A replay outside the
24-hour terminal deduplication window can become a new receipt; sources should acknowledge and remove delivered
outbox entries, not replay their entire history forever. Quiet receipts from one extension cannot starve another.
Errors are sanitized and exposed by `extensions.events_get`. Changing extension credentials also revokes opt-in.

## Current limits

- Not a shared replacement for all built-in event sources. Gmail is unchanged.
- Not a public listener or independently credentialed remote emitter.
- Monitor deadlines and process reuse are the MCP manager's existing contract; no stronger sandbox is implied.
- A cloud-polling source can miss a complete short cycle between samples. hOn's conservative profile needs observed
  countdown progress and two spaced completed samples; it never infers completion from a timer or a lost connection.
- Controls, when an integration offers them, are separate explicit actions and require their own safety boundaries.

Docs impact: updated extension user guides in English and Spanish and HUMAN_MODEL.md; this reference describes the
new protocol, CLI, source contract, failure/revocation behavior and security limits.
