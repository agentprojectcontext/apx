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
| `/flows/<registered-flow-id>` | POST | A separate APX bearer token for that exact endpoint; the registered destination owns payload validation and execution |
| `/a/<published-share-link>` | GET, HEAD | Explicit publication; a read-only page, never artifact state, stores, secrets or actions |
| `/_apx/kit@1[.minor[.patch]].js` | GET, HEAD | Static public widget kit only |

Everything else is denied, including arbitrary prefixes, suffixes, private media URLs and RPC. Unknown routes return
404, wrong methods 405, missing/invalid/revoked tokens 401. No query parameter or cookie supplies a public bearer token.
Ambiguous request targets (percent encodings, backslashes, dot segments, repeated slashes, absolute URLs and control
characters) are rejected before URL normalization. Reverse proxies must preserve the request target and enforce equally
strict normalization; a proxy that rewrites an ambiguous request into a different canonical route changes this boundary.

LINE and Teams are deliberate exceptions to APX bearer authentication, not unauthenticated generic webhooks. LINE
requires its HMAC over the original request bytes. Teams requires the Bot Framework JWT with its existing issuer,
audience and endorsement checks. These platforms cannot be assumed to attach a custom APX bearer. Rotating their
provider credentials uses the existing channel configuration, not a shared APX global webhook token.

## Route credentials

Human-only protocol operations run through the private router:

1. `public_routes.list {}` lists registered destinations and whether they have a live credential.
2. `public_routes.rotate {"path":"/flows/<id>"}` enables or rotates one registered endpoint. The result contains a
   `secret_ref`, never the bearer value. Reveal that reference through the existing owner-only `secrets.reveal` operation,
   or use Enable token / Rotate token in Settings › Devices. Copy the token into the caller's secure secret store.
3. Send `Authorization: Bearer <token>` on every webhook POST. Use a different token for every integration/route.
4. `public_routes.revoke {"path":"/flows/<id>"}` removes that credential immediately. A revoked or old rotated token
   cannot deliver an event; another endpoint's token never works here. A deleted destination is no longer a public route.

Tokens have 256 random bits and live in APX's Secrets backend (OS keyring when available; protected file otherwise).
SQLite settings and idempotent management replies contain references only. Rotation removes the old secret. Management
operations are owner-only, require normal protocol authentication and an idempotency key for mutations, and cannot be
called through the public listener. An agent or external API client does not gain owner access by knowing a route token.

## Limits and failures

The public listener caps bodies at 1 MiB and headers at 16 KiB. A 15-second deadline covers both body upload and handler
execution, aborting downstream work. Destinations must honor the AbortSignal; a non-cooperative in-flight handler keeps
its concurrency slot until it settles, rather than allowing unlimited orphan work. Connections close after responses.
At most 128 requests execute concurrently and 256 connections are accepted. Rate limits are shared across callers:
120 requests per registered route per minute and 1,200 total requests per minute, with bounded bucket storage. A 429
includes Retry-After; these are resource safeguards, not per-user fairness or internet-scale DDoS protection. Put a
provider/proxy rate limit in front of an internet installation when appropriate.

Logs identify only registered route IDs and generic failure categories, never request bodies, bearer headers, URL
queries or adapter exception text. Public errors contain no internal exception details. Flow acceptance, idempotency,
retries, durable runs and project authorization remain the Flow service's responsibility; HTTP timeouts do not imply
that an already accepted side effect was rolled back.

## Publishing a widget

Widgets remain private until the owner explicitly chooses the existing public-link action (`surfaces.share`). Turning
on a tunnel does not publish private widgets. Turning publication off invalidates the old link; publishing again creates
a different one. Copy/open uses the public tunnel when available, otherwise the current private host.

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
