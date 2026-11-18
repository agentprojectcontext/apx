# Public artifact copies (implementation in progress)

F4 uses the free Firebase plan: Firestore holds snapshots and Hosting serves a fixed viewer. No Storage,
Functions, Blaze plan or billing activation is part of this implementation. This is not yet a released or
deployed service. The existing local `surfaces.share` listener is unchanged.

## Snapshot boundary

`apps/core/src/domain/public-artifact-copy.ts` prepares an installable `apx-artifact@1` copy from an allowlist:
name, title, kind, version and HTML. State is omitted by default. Only explicitly selected, currently present
state keys can enter the snapshot. A missing key fails preparation instead of publishing an incomplete selection.
The result owns a JSON snapshot and SHA-256 hash: subsequent local edits cannot change its approved bytes.

The builder never opens the artifact database, key-value store, secret store, chats or project memory. It does
not include author, agent, project identifiers, connection grants or secret declarations. Known `secret://`
references fail preparation. This is not secret detection: HTML and explicitly selected state can already
contain sensitive text. The final confirmation must show the exact copy that will leave the machine; it must
not imply a scanner can establish the absence of arbitrary credentials in user-authored content.

An eight-character lowercase Crockford code is sampled independently using cryptographic random bytes. It
contains no user input or account prefix. Forty random bits are not authorization: pages are public. Code
reservations are immutable, private tombstones so revoked codes cannot be reassigned or republished.

## Firestore layout and limits

- `artifactOwners/<code>`: immutable private ownership (`uid`, `slot`), visible only to its owner.
- `artifactAccounts/<uid>/slots/<0..19>`: private occupied slots (`code`), listable only by that account.
- `publicArtifacts/<code>`: public title, byte count, hash, part count and server update time; no user ID.
- `publicArtifacts/<code>/parts/<0..7>`: base64-encoded UTF-8 JSON, at most 700,000 ASCII characters per document.

The maximum decoded copy is 4,200,000 bytes (eight parts), below 900 KB per stored document. A maximum of 20
active slots bounds an account to 84 MB of snapshot payload. Existing `.apxart` HTML limits still apply:
400,000 characters of HTML. Large selected state can use the rest of the budget. Base64 avoids ambiguity between
Unicode character limits and Firestore's byte limit. Rules validate ASCII shape and fixed part IDs, not a
client's size claim, so forging the declared byte count cannot bypass the physical snapshot bound.

Public documents support exact `get`, never `list`. Knowing one code does not allow enumerating the catalog.
An owner atomically creates the private reservation, free slot, metadata and all parts. The rules check the
post-commit document state; a claimed owner ID is not authority. An update replaces the metadata and parts in
one commit and removes no-longer-needed parts. The client uses update-time preconditions so concurrent changes
fail instead of overwriting a newer revision. Standalone part writes cannot change the published copy.

Revocation deletes the public metadata, every part and the private occupied slot in one commit. The private
ownership tombstone remains. Releasing or replacing a slot while the old publication is live is refused.
There are no public Storage objects, signed URLs or download tokens to bypass revocation.

## Fixed Hosting viewer (implemented; deployment pending)

`https://artifact.apxagent.app/<code>` serves a trusted fixed wrapper. It reads the public Firestore metadata
and exact part IDs using network-only REST requests, checks size and SHA-256, and renders the chosen snapshot
inside an opaque-origin sandbox. It never enables Firestore persistence, service-worker caches or credentialed
requests. The loaded HTML cannot access the wrapper, account cookies or APX RPC. Apply CSP to the execution
document as well as the wrapper. External networking, frames and APX access are disabled; the snapshot's
inlined APX Kit supports offline copies. No uploaded HTML executes in the wrapper's origin.

The execution iframe requires a boolean `credentialless` attribute as well as `sandbox="allow-scripts"`.
A browser without credentialless support gets the download action, not a less-isolated execution frame. The
page explains that its browser cannot show the preview. No sign-in or account cookie is needed by the viewer.

The page observes publication changes while open and removes the iframe and download when revoked. Cached
listener observations are a loading state, not evidence that a copy is live or missing. Reads and downloads have
15-second deadlines; cancellation and listener generations prevent late bytes or detached listeners from
restoring a removed preview. These timing paths are covered with injected timers, not wall-clock sleeps. Before
creating a download, re-read the current publication instead of reusing previously loaded bytes. A person can
keep a copy they have already downloaded: revocation stops subsequent access through APX, not possession.
`Open in APX` downloads the approved `.apxart`; opening it still requires the existing installation dialog.
Neither a public URL nor a deep link installs it automatically.

Free-plan Firestore quotas still constrain total reads and writes across the project. Rate abuse can exhaust
the free quota and temporarily stop publication/viewing; this does not authorize enabling billing. Surface that
error honestly, preserve confirmed state and document the limits. Do not weaken the open telemetry policies.

## APX integration (draft service implemented; protocol and UI pending)

`public-artifacts/drafts.ts` creates expiring, opaque preview IDs without uploading anything. Its snapshots bind
the chosen state, source hash, account generation and remote revision. A changed source or signed-out account
cannot commit the old preview. Concurrent commits share one write; completed previews return their old receipt
without reapplying it. Preview data is copied, so a caller cannot mutate the internal approved snapshot.
The service remains unexposed until the human-access protocol boundary and mandatory owner cards are wired.

Use the single protocol registry/router for preparation, publishing, updating, revoking and listing. Effect
methods require idempotency keys. Session resolution stays inside the core. Publishing and updating public
bytes require an owner card even in Total mode and even when an agent requests the action. Approval binds the
exact hash, selected state, account and target revision; an edit requires a fresh confirmation.

The publication list belongs to the signed-in account, not the current local project. It remains useful if
the original local artifact has gone. Offline errors preserve the last confirmed status. Signing out discards
account-specific in-flight results. No cloud account is required for existing local use.

## Verification required before delivery

1. Snapshot/chunk/usage unit tests, including invalid state, byte limits and exact approved bytes.
2. Real Firestore emulator tests: anonymous/other-account writes, private ownership access, public enumeration,
   incomplete writes, slot exhaustion/races, code collisions, part sizes, update preconditions and revocation.
3. Separate core with file-backed secrets, correct revision, actual protocol paths and mandatory owner cards.
4. Deployed viewer checked from an outside phone with the publishing core stopped. Check CSP, sandbox, download
   verification and revocation. Check already-open viewers and every public part URL.
5. Desktop/phone-width screenshots in both languages against the reference; EN/ES user docs and a decision
   record with the completed integration. No news entry, announcement, release or merge to staging.

The F3 account bridge is not yet integrated into this branch. Merge its rule changes carefully with these rules;
never replace unrelated telemetry/account policies during deployment. Use the separate artifact Hosting site
and approved DNS tools without changing the login origin or restarting the owner's core.

Docs impact: updated — this document records the snapshot and free-plan cloud boundary. EN/ES user instructions
remain pending the completed integration.
