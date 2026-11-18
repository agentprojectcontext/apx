# Public artifact copies

F4 publishes independent copies through a Cloudflare Worker and private R2 bucket. Firebase `apx-agents` retains account authentication, telemetry and private publication ownership/slots. Public viewing never reads Firebase, even with its quota exhausted. No new Firebase project, Storage, Functions, Blaze upgrade or administrator key is introduced. Workers/R2/Durable Objects have their own free limits; R2 checkout/card activation belongs to the owner. Do not claim production deployment from local tests. The existing local `surfaces.share` listener is unchanged.

## Snapshot boundary

`apps/core/src/domain/public-artifact-copy.ts` builds an installable `apx-artifact@1` allowlisted copy: name, title, kind, version and HTML. State is omitted by default. Only selected, currently present top-level state keys enter the immutable JSON snapshot and SHA-256. Missing selections fail rather than silently dropping values.

The builder never opens the artifact database, store, secrets, chats or project memory. Author, agent/project identifiers, grants and secret declarations are excluded. Known `secret://` references fail preparation. This is not secret detection: HTML or selected values can already contain sensitive text. Confirmation shows the exact source, rendered preview and chosen values, not a scanner's assurance.

Each code is eight independently sampled lowercase Crockford base32 characters, with no user ID or account prefix. Forty random bits are not authorization: anyone with the link may read it. Permanent private ownership reservations and durable account tombstones prevent reassignment or reuse after revocation.

## Storage and authorization

Firestore stores no content:

- `artifactOwners/<code>`: immutable private owner and slot.
- `artifactAccounts/<uid>/slots/0..19`: private occupied slots, listable only by their account.
- `publicArtifacts/<code>`: private title, UTF-8 byte count, SHA-256 and server update time.
- Former `parts` paths deny all reads and writes, including the owner's. Metadata denies anonymous reads and enumeration.

R2 stores `heads/<code>` (private owner, slot, public metadata and revision) and immutable `copies/<code>/<hash>` bodies. Do not enable public R2 bucket access or a direct download route. Only the Worker returns public title/size/hash/revision and verified body bytes; private owner identity never enters its anonymous responses.

The Worker validates Firebase ID tokens with Web Crypto RS256, Google's fixed public key endpoint, expected project audience/issuer, subject and expiration. Only authenticated account operations use that token in Firestore REST; no service-account key exists. Ordinary ID-token validity applies: signing out of one core does not revoke sessions on other cores or previously issued tokens globally.

A SQLite Durable Object per account serializes mutation work and independently enforces twenty active copies and sixty mutations/hour. Firestore slots alone cannot enforce the R2 quota because an account can edit its own Firebase documents. A request cannot impersonate another account with an internal header: the edge verifies the token and sets the internal identity itself. Code claims precede body writes, preventing a competing account from overwriting/deleting another claimant's data.

Each copy is at most 10 MB (10,000,000 UTF-8 bytes, including HTML and selected state), checked before upload in the core and independently before any content write in the Worker. Oversized copies are rejected whole, never split or truncated; the artifact stays local. External file and video references are not fetched or embedded. Creation never publishes: an explicit publication and human confirmation are required. The 1 GB aggregate R2 budget is unchanged; HTML retains the `.apxart` limit of 400,000 characters. Selected state can use the remaining bytes. Updates check the current immutable revision, retain the public code and may use a different local source. Retrying a matching committed copy returns success without a new slot.

## Cache, revocation and cost boundaries

Public metadata checks R2 directly, without pointer caching. Body reads check the pointer before cache access and again before returning bytes. Only immutable bodies use Cloudflare's internal cache; its keys have no public route. Public responses use `no-store`. Old cached bodies are not a bypass for a missing or changed pointer. Anonymous reads also check the account's durable revocation flag through a read-only path, outside its mutation queue. A late/uncertain old R2 put cannot resurrect a code, and a stalled Firebase mutation cannot block these checks.

Revocation records the exact authorized pointer in the account Durable Object, then deletes the R2 pointer before best-effort Firebase/body cleanup. R2 deletes require no put budget. A durable retry prevents an uncertain response or failed cleanup from republishing the code. Pending cleanup runs on the owner's next list request, one entry at a time. Slot deletion compares the slot's current revision and code so a retry cannot remove a reused slot. Every upload records its new and previous body hashes durably before writing content. If a body upload was acknowledged but the pointer response was lost, recovery completes the same approved revision before reclaiming older bodies; a revocation tombstone forbids that completion. Obsolete acknowledged objects release their budget only after confirmed deletion. Unacknowledged body writes keep conservative reservations and durable sweep records, retried one at a time on listing without deleting a current live body. It runs on listing, before another update and after revocation; failed cleanup retains the journal. Ownership proof is persisted before uploading so interrupted first uploads cannot reclaim another account's content or lose that proof when metadata is released. If an unused first-upload slot was reclaimed, close the failed review and prepare a new one; an approved URL is never silently changed. A Firebase outage can retain a slot temporarily, never undo a successful pointer deletion.

A separate trusted Durable Object transactionally reserves global R2 storage and operations: 1 GB including a per-object margin; 500,000 puts/calendar month; 7.5 million ordinary gets/month and 9.5 million total gets including authenticated management. Reservations are conservative after failed or uncertain writes and return only after confirmed deletion. Monthly counter reset never discards stored-byte reservations. Exceeding a budget fails closed, not into paid usage. Approximate native IP limiting is 120 requests/minute per Cloudflare location; it is not a global WAF.

These ceilings concern this deployment, not unrelated workloads consuming the same Cloudflare account's allowances. Workers/Durable Objects free request, CPU, duration and storage ceilings also limit availability. Do not enable a paid plan, promise unlimited traffic or claim the entire shared account cannot incur a bill. See [infrastructure setup](../firebase/README.md) and its Spanish counterpart. If R2 activation asks for checkout/card information, only the owner may complete it.

## Fixed Worker viewer

`https://artifact.apxagent.app/<code>` serves a fixed wrapper and separate runner. The viewer has no Firebase SDK, Firebase build variables, persistence or account authentication. Its ordinary network requests are same-origin only. Hashed assets are immutable; HTML and APIs are uncached. CSP is applied to both wrapper and execution document, with distinct `frame-ancestors` policies.

Requests to `/` or `/index.html` without a copy code redirect to `https://apxagent.app`; copy-code links keep opening the viewer. Query strings cannot choose the redirect destination.

The build packages `index.html`, `runner.html` and the viewer's hashed JavaScript/CSS as text modules in the same Worker upload. No static-assets binding, separate upload session or assets JWT exists. The scripts API uses the existing credential reference; Wrangler and Miniflare are local build/test tools. Source maps and unknown asset paths are not served. All routes still pass through the same response-header boundary.

The execution iframe always has `sandbox="allow-scripts"`, never `allow-same-origin`. `credentialless` adds isolation where supported but is not required: Firefox, Safari and iPhone browsers use the same opaque sandbox. No uploaded HTML executes in the wrapper's origin. The runner denies network requests, frames, forms and an APX bridge; inlined APX Kit and a cloned state selection work offline. CSP is not an IP-anonymity firewall: WebRTC/STUN and DNS prefetch remain browser-level limitations.

A same-origin hibernatable WebSocket delivers change/revocation notifications, without repeated pointer polling or awake idle Durable Objects. The viewer closes its stream while hidden and confirms metadata again when visible. Opening a socket triggers one fresh copy read to catch updates made between the initial read and registration; no idle polling is added. Retained streams are capped at twenty per copy and one hundred per account, bounding fan-out and memory. Disconnects clear unconfirmed previews and reconnect with bounded backoff; handshake deadlines and reconnect timers are injected in tests. A notification clears revoked previews and downloads immediately; a failed connection is not evidence that cached bytes remain live. Controller deadlines, cancellation and generations prevent late reads or detached callbacks from restoring a removed preview; timing tests use injected clocks. Each download fetches and verifies bounded UTF-8 bytes, SHA-256 and current revision again, rather than reusing a rendered snapshot.

`Open in APX` carries only an exact code to `apx://artifact/<code>`. The human-only `surfaces.public_read` method reads anonymously from the fixed edge origin, checks size/hash and revision again, then opens the existing installation dialog. It forwards no account token and accepts no arbitrary remote URL. Recipients need no account. `Download file` saves the `.apxart` separately. Neither path installs automatically. Revocation prevents subsequent service reads; it cannot recall a downloaded or already rendered copy.

## APX integration

`public-artifacts/drafts.ts` prepares opaque reviews without uploading. Twenty selected snapshots are retained privately for thirty days, extended through a pending card's actual deadline. The database stores metadata/integrity references; immutable bytes live in `<home>/public-artifact-drafts` (0700 directory, 0600 files on POSIX; home ACL on Windows). Unchanged files are reused. Bytes stage before metadata commits, failed commits roll back new files, and obsolete files are pruned only after success. Back up both database and draft folder. Validated inline data migrates without losing pending cards; a failed migration preserves the original row. Missing/corrupt bytes invalidate only their own review.

A confirmed remote result wins over local receipt/diagnostic failures. Lost mutation responses are reconciled against the Worker's current private R2 metadata. Inspect the published list before retrying after local storage failure. Twenty separate metadata-only revocation reviews and twenty metadata-only receipts do not consume selected-copy review capacity. Abandoned reviews can be replaced, never in-flight writes or live pending cards. Closing a human-started review releases it; closing an agent's review preserves its pending request. No session credentials, generations or human review tokens persist. Restart requires a fresh exact review by the same account.

Reviews bind selected bytes, source hash, account generation and remote revision. Source/account changes invalidate uncommitted approval. Concurrent commits share one write; completed drafts return their receipt while retained. Preview values are copied, not mutable references into the approved snapshot.

The protocol exposes `surfaces.public_list`, `public_prepare`, `public_preview`, `public_commit`, `public_discard` and `public_read`. Preview, commit, discard and read are human-only. Preparation never uploads. Confirmation binds the exact copy/account/revision; edits need fresh confirmation. Agent tools may prepare only artifacts in their exact project, not global artifacts, and cannot read an identity-bearing preview or commit directly.

Agent commits require a target-bound owner card even in Total mode. The card opens the exact copy; generic approve-once/always controls cannot authorize publication. Its human-only review token must match the card draft. Phone approval controls direct the owner to review on their computer. Transport actors cannot grant themselves owner rights. Token resolution stays in the core.

The account's published list remains useful without its original local source. Offline errors preserve last confirmed status. Sign-out discards account-specific in-flight results and prevents further cloud requests; it cannot retract a write already sent to the Worker. Existing local artifacts require no cloud account.

## Verification before delivery or deployment

1. Snapshot/state/usage regressions, raw-byte hash checks, malformed copy boundaries, reviewed-card persistence and lost-response reconciliation.
2. Actual Firestore emulator: account/telemetry parity, private metadata authorization, denied content/parts, atomic slots, races/collisions, shape/size/timestamp validation and idempotent cleanup.
3. Actual local workerd/R2/Durable Objects: JWT signatures/claims, per-account and aggregate quotas, cross-account isolation, warm-cache revocation and viewing with Firestore unavailable. A mocked metadata transport does not replace emulator tests.
4. Separate core and file-backed secrets, expected commit SHA, actual protocol/owner-card paths and native installation without automatic install.
5. Built viewer through the actual Worker headers, Chromium/Firefox/WebKit, desktop/phone screenshots in both languages against [the reference](PUBLIC_ARTIFACTS_UI.md), and independent review. `pnpm test:firebase` starts the demo emulator and Worker, not Hosting or Vite. Run `pnpm test:firebase:native` separately on a desktop-capable host.
6. Production Worker/R2 and approved DNS only after tests; inventory existing publications before any approved data migration. Verify HTTPS, public reads with publishing core stopped, CSP, download and revocation, including an already-open phone page. Record measured production timing separately from local timing. Retire the old Hosting site only after the Worker domain works.

No announcement, owner news entry, release or merge is part of this rollout. Production deployment and outside-device checks must be reported as unverified when permissions or owner activation block them.

Docs impact: updated — this boundary document, [the public artifact decision](DECISIONS.md#d-248), infrastructure EN/ES setup, release verification and artifact user guides cover R2/Worker, Firebase independence, authorization, budgets, cleanup and the limits of revocation.
