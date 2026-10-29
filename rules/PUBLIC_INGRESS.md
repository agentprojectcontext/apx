# Public ingress

APX has two different network boundaries. The private daemon serves the panel, RPC and device connections.
The public listener binds only to loopback (the preferred port is the private port plus eight) and has no panel,
RPC, WebSocket upgrade, health endpoint, filesystem fallback or general reverse proxy. Publish **only that listener**.

## One tunnel, explicit resources

Settings › Devices configures the shared public address; channel settings offer the same configuration, not a second
tunnel. The existing `webhooks.get` / `webhooks.set` protocol methods and saved `webhooks` setting control it.
`apps/core/src/public-tunnel.ts` owns the infrastructure independently of channel adapters.

- **Tailscale Funnel:** HTTPS on port 8443 forwards to the public listener. Private Tailscale Serve on 443 is untouched.
- **ngrok:** APX starts a bounded child process pointing only at the public listener. A reserved domain is optional.
- **Custom:** an HTTPS origin, without userinfo, path, query or fragment. Configure the owner's reverse proxy to forward
  to the listener's actual loopback port. A proxy prefix must be stripped before forwarding; it is not a route alias.
- **Off:** no APX-managed public tunnel. A separately configured reverse proxy remains the owner's responsibility.

The provider supplies a hostname or public IP and its lifetime. APX does not allocate or promise a fixed public IP.
Forwarded headers do not grant access and are not trusted as client identity. No daemon token belongs in a tunnel URL.

## Allowlist and authentication

| Resource | Methods | Authentication |
| --- | --- | --- |
| `/hooks/<configured-channel-id>` | POST | Only LINE and Teams; the adapter verifies the native signature/JWT before delivering any event |
| `/flows/<flow-path>` | POST, GET (as its webhook step says) | A separate APX bearer token for that exact endpoint; the registered destination owns payload validation and execution |
| `/flows/test/<flow-path>` | POST, GET (as the drawing tested says) | Only while the owner listens for one test event on that Flow (five minutes, one event); the address's bearer token when it has one |
| `/a/<published-share-link>` | GET, HEAD | Explicit publication; a read-only page, never artifact state, stores, secrets or actions |
| `/_apx/kit@1[.minor[.patch]].js` | GET, HEAD | Static public widget kit only |

Everything else is denied, including arbitrary prefixes, suffixes, private media URLs and RPC. Unknown routes return
404, wrong methods 405, missing/invalid/revoked tokens 401. No query parameter or cookie supplies a public bearer token.
Ambiguous request targets (percent encodings, backslashes, dot segments, repeated slashes, absolute URLs and control
characters in the path; control characters, fragments or more than 4 KiB in the query) are rejected before URL
normalization. Only a Flow's GET reads the query, decoded with `URLSearchParams` into its event's data
([D-182](DECISIONS.md#d-182)); every other route ignores it. Reverse proxies must preserve the request target and enforce equally
strict normalization; a proxy that rewrites an ambiguous request into a different canonical route changes this boundary.

LINE and Teams are deliberate exceptions to APX bearer authentication, not unauthenticated generic webhooks. LINE
requires its HMAC over the original request bytes. Teams requires the Bot Framework JWT with its existing issuer,
audience and endorsement checks. These platforms cannot be assumed to attach a custom APX bearer. Rotating their
provider credentials uses the existing channel configuration, not a shared APX global webhook token.

Native deliveries propagate the request deadline and disconnect signal through the channel manager. LINE cancels
profile, group and image requests and checks cancellation before delivery; a concurrent copy of an in-flight event
gets 503 so the provider retries instead of losing or duplicating the event. Completed LINE event IDs retain the
existing persisted bounded deduplication. Teams cancels signing-key requests and checks cancellation before its
synchronous delivery; its bounded activity-response cache suppresses retries during the adapter lifetime, not across
restarts. Cancellation does not roll back an event already delivered. These are not exactly-once guarantees.

**Español:** El deadline o la desconexión cancela las consultas nativas y evita nuevas entregas tras la cancelación.
LINE responde 503 a una copia concurrente todavía en curso para que el proveedor reintente; conserva la deduplicación
persistente acotada de eventos terminados. Teams cancela la consulta de claves y conserva respuestas de actividades
en una caché acotada mientras vive el adaptador, no entre reinicios. Cancelar no revierte una entrega ya realizada
ni garantiza ejecución exactamente una vez.

## Route credentials

Human-only protocol operations run through the private router:

1. `public_routes.list {}` lists registered destinations and whether they have a live credential.
2. `public_routes.rotate {"path":"/flows/<path>"}` enables or rotates one registered endpoint. The result contains a
   `secret_ref`, never the bearer value. Reveal that reference through the existing owner-only `secrets.reveal` operation,
   or use Enable token / Rotate token in Settings › Devices. Copy the token into the caller's secure secret store.
3. Send `Authorization: Bearer <token>` on every webhook POST. Use a different token for every integration/route.
4. `public_routes.revoke {"path":"/flows/<path>"}` removes that credential immediately. A revoked or old rotated token
   cannot deliver an event; another endpoint's token never works here. A deleted destination is no longer a public route.

Tokens have 256 random bits and live in APX's Secrets backend (OS keyring when available; protected file otherwise).
SQLite settings and idempotent management replies contain references only. Rotation immediately replaces the active
reference. A bounded durable cleanup journal tracks the new secret before creation and atomically records the previous
reference when activation commits. Cleanup references never authorize a request. Failed deletion is retried at core
startup and before/after subsequent rotations; it does not hide a successfully activated credential from the caller.
An interrupted or failed activation leaves the prior credential active and the abandoned reference eligible for cleanup.
If 1,000 references remain pending, restore the secret backend before rotating again; there is no periodic cleanup job.
Management operations are owner-only, require normal protocol authentication and an idempotency key for mutations, and cannot be
called through the public listener. An agent or external API client does not gain owner access by knowing a route token.

A Flow's path is its own (`flows.path`, [D-178](DECISIONS.md#d-178)): unique, from its name when made, renamed by the
owner with `flows.path_set`. A rename stops the old address at once and moves its credential to the new one, so the
caller keeps its token and changes only the URL. A Flow from before paths has its identifier as its path.

## Test events

`/flows/test/<path>` exists for the owner's test from the Flow editor ([D-178](DECISIONS.md#d-178)). It runs nothing
unless the owner started listening on that Flow (`flows.test_start`, owner-only, with the same `outward` approval
publishing needs). Not listening, `/flows/test/…` is no route at all: the listener's bare 404, with no body read,
whether or not a Flow has that path. Listening lasts five minutes and takes one event: the same envelope, size, content
type, deadline and rate limits as `/flows/<path>`, and the address's bearer token once it has one (an address whose
token can't be read now refuses, as production does). The first valid event ends the listening before it is admitted,
so a concurrent second POST gets 404; so does one whose Flow was renamed while its body arrived. The event runs the drawing
pinned when listening started, as a durable run marked as a test, whether the Flow is on or off. Listening is kept in
memory: a restart ends it. Until an address has a token, a test event is accepted from whoever knows the test address
during that window; give the address a token first when that matters.

**Español:** `/flows/test/<path>` solo corre algo mientras el dueño escucha un evento de prueba en ese Flow: cinco
minutos, un evento, con los mismos límites que la dirección real y su token cuando lo tiene. Sin escuchar, cualquier
`/flows/test/…` responde el mismo 404 y no corre nada.

## Limits and failures

The public listener caps bodies at 1 MiB and headers at 16 KiB. A 15-second deadline covers both body upload and handler
execution, signalling cancellation to downstream work. Destinations must honor the AbortSignal, bound their I/O and
check cancellation before starting effects; cancellation cannot reverse an effect already committed or forcibly stop
in-process code. A non-cooperative in-flight handler keeps
its concurrency slot until it settles, rather than allowing unlimited orphan work. Connections close after responses.
Authenticated oversized uploads receive 413 headers immediately; the listener discards at most another 1 MiB + 64 KiB
without buffering before closing, under the same concurrency slot and deadline. This bounded grace drain avoids
resetting ordinary just-over-limit uploads while never promising to drain an unlimited sender.
At most 16 requests execute per route, 128 execute globally and 256 connections are accepted. Rate limits are shared across callers:
120 requests per registered route per minute and 1,200 total requests per minute, with bounded bucket storage. A 429
includes Retry-After; these are resource safeguards, not per-user fairness or internet-scale DDoS protection. Put a
provider/proxy rate limit in front of an internet installation when appropriate.

Logs identify only registered route IDs and generic failure categories, never request bodies, bearer headers, URL
queries or adapter exception text. Public errors contain no internal exception details. Flow acceptance, idempotency,
retries, durable runs and project authorization remain the Flow service's responsibility; HTTP timeouts do not imply
that an already accepted side effect was rolled back.

## Publishing a widget

Widgets remain private until the owner explicitly chooses the existing public-link action (`surfaces.share`). Turning
on a tunnel does not publish private widgets. Previously shared widgets become reachable through the tunnel immediately;
they do not require a second publication. Turning publication off invalidates the old link; publishing again creates
a different one. Copy/open requires a configured public address; an unavailable tunnel never falls back to the private
panel origin. Opening a link reserves a blank tab during the click, closes it on discovery failure and navigates only
after the public address is known.

Review the HTML before publishing: literal content embedded in it is public. Public ingress never supplies the widget's
saved state, artifact store/database, private media, provenance, project data or secrets. The kit is inlined. Include
portable images/fonts as data URLs; private `media:<id>` references and private APX APIs do not become public assets.
Public CSP uses an opaque sandbox, allows inline rendering scripts/styles, and blocks network connections, forms,
frames, external scripts and private resource loads. A widget needing APX actions, persisted data or authenticated live
integrations belongs inside APX, not on this read-only public host. Do not publish secret literals inside its HTML.

## Verification and rollback

Behavioral coverage lives in `transport/hooks.test.ts`, `public-credentials.test.ts`, `public-surfaces.test.ts` and
`public-tunnel.test.ts`, plus native LINE/Teams auth tests. A real internet/provider check is separate from local listener
and protocol tests. To stop an individual resource, revoke its token or unpublish the widget. To stop APX-managed ingress,
set the public address to Off; also remove any independently managed reverse proxy forwarding rule. Never compensate
for a public routing failure by forwarding the private daemon instead.
