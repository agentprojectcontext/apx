# Firebase account backend and public-artifact infrastructure

APX accounts use Firebase Authentication (Google) and Firestore REST in `apx-agents`. Login and telemetry stay there. Public HTML and selected state live in Cloudflare R2, behind the artifact Worker; opening a public link never reads Firebase. No new Firebase project, Cloud Storage, Functions, service-account key or Firebase billing upgrade is required.

## Account configuration

Enable Google in Firebase Authentication and create a Firebase web app. Use the existing Google **Desktop app** OAuth client for the installed-app authorization flow. The Firebase API key and desktop client identifier are public application configuration, not authorization boundaries. Never package administrator credentials.

Supply `APX_ACCOUNT_CLIENT` as JSON with `project` and `apiKey`, or package `account-client.json` at the core root. Supply the desktop Google client through `APX_GOOGLE_CLIENT` or packaged `google-client.json`. Distribution builds inject these through the existing staging scripts. Do not commit local configuration files. The deployed artifact Worker's `FIREBASE_PROJECT` must match the account project; changing a local project alone neither migrates accounts nor authorizes publication on another deployment.

The core requests only `openid email profile` with PKCE S256 and a random, expiring state. Google returns to `http://127.0.0.1:<core-port>/oauth/account`. The return page always completes the registered loopback-only `account.finish` protocol method in the browser, including desktop development builds and AppImage. The optional `apx://account/signed-in` link only brings the desktop app forward; it carries no code or state and is not required to sign in. No second HTTP authentication handler is introduced. Firebase validates the Google ID token through `accounts:signInWithIdp`; renewal uses Secure Token's refresh endpoint.

The browser and core must be on the same computer. A phone or remote browser cannot reach that loopback address. Remote sign-in would require a separately approved HTTPS broker. A local build must serve the built panel to render the return page.

## Data and authorization

- `users/<Firebase UID>` holds the private profile: eight-character ID, name, photo and optional handle.
- `accountIds/<code>` reserves an immutable profile ID; `accountHandles/<handle>` reserves a unique handle.
- Atomic commits create matching profile/reservation documents with `exists: false` preconditions. Conflicts never overwrite another account. Renames compare the profile revision, reserve the new handle and release the old one atomically.
- Rules forbid profile enumeration, reading other profiles, changing an ID and retaining obsolete handle reservations.
- The core stores Firebase ID and refresh tokens together only in its secret store. Account protocol results contain no tokens. Account methods are owner-only and do not return session credentials to agents. The secret store is not an isolation boundary against owner-approved tools: an approved MCP explicitly configured with `secret://apx-account-session` can resolve that secret. Sign-out deletes this core's secret, not the cloud profile or sessions on other cores.
- Profile IDs are not artifact codes. Account creation publishes nothing.
- Telemetry keeps its existing anonymous write rules. Private reads require `telemetry_reader: true`; an ordinary Google account gains no telemetry access. A daily usage report may carry the optional counts and public extension ids of D-257; deploy these rules before a release whose cores send them, or those days are refused and retried.
- `artifactOwners/<code>` permanently reserves a code and its owner/slot. `artifactAccounts/<uid>/slots/0..19` bounds active metadata reservations. `publicArtifacts/<code>` contains only private title, byte count, hash and timestamp. Anonymous reads, enumeration, HTML and former `parts` documents are denied.

## Public content: Worker and R2

`apps/artifact-worker` serves the fixed viewer, runner and content on `artifact.apxagent.app`. Opening a copy needs no Firebase: the page, its metadata and its body come from the Worker. Each copy's page is rendered with its title, description, canonical link, preview image (`/og.jpg`), icon and schema.org data, so search engines and link previews can read it; a code with no live copy answers 404 with `noindex`. Optional Google sign-in lets an owner manage their copy from the page: set the Worker variable `FIREBASE_WEB_KEY` to the Firebase web app's public API key and add `artifact.apxagent.app` to Firebase Authentication's authorized domains. Only then does the page announce the client, lazy-load the Firebase Auth SDK (when its menu opens or a session was kept) and allow `apis.google.com`, `<project>.firebaseapp.com`, Identity Toolkit, Secure Token and Google profile photos in its CSP. The owner's actions use the same private routes as the core (`inspect`, `revoke`) with the person's Firebase ID token. The opaque runner has no network or APX connection, and its sandbox cannot read the page's session. Static hashed assets are immutable; HTML, pointers and public API responses are `no-store`.

The R2 bucket is private: do not enable `r2.dev`, a public bucket domain or direct downloads that bypass the Worker. Bodies are immutable by code/hash. Every download checks a fresh R2 pointer before serving a cache hit and checks the revision again before completing. No public read calls Firestore or verifies a Firebase token. Read-only durable revocation checks bypass the account mutation queue, preventing late R2 writes from resurrecting a code without waiting for Firebase mutations.

Publishing/updating/revoking calls the Worker with the person's Firebase ID token. Web Crypto verifies RS256 against Google's fixed public key endpoint, expected audience/issuer, subject and expiration. Owner and slot operations use that same token in Firestore REST. No administrator credential is deployed. A token's normal validity window still applies; local sign-out is not global token revocation.

A SQLite Durable Object per account serializes mutations and enforces twenty active copies independently of client-editable Firebase slots, plus sixty mutations/hour. Each copy is at most 10 MB (10,000,000 UTF-8 bytes, including HTML and selected state). The core rejects an oversized selection before any content upload; the Worker independently rejects the entire body before storing anything. Referenced videos and other files are not fetched or embedded. Creation stays local; only an explicit publish action followed by human confirmation uploads a copy. The shared R2 storage budget remains 1 GB. A native edge limit allows approximately 120 requests/IP/minute per location, not a global WAF guarantee.

Revocation records a permanent account tombstone and deletes the R2 pointer before cleaning up content and Firebase metadata. R2 deletes do not need a write allocation. Pending cleanup is retried when the owner next lists their copies. A Firebase outage can delay reclaiming a slot, never restore the public pointer. A durable upload journal tracks both new and previous bodies, including updates. Listing and the next update finish the same approved revision if its body upload succeeded but its pointer response was lost; revocation forbids that completion. Obsolete acknowledged bodies release their storage reservations only after confirmed deletion. Unacknowledged body writes keep conservative reservations and durable sweep records; listing retries their deletion without removing a current live body. Failed cleanup preserves the journal and ownership proof. Listing also reclaims unused metadata from interrupted first uploads; after reclamation, prepare a fresh review instead of retrying the old code. A hibernatable WebSocket notifies connected viewers without periodic reads. The handshake triggers one fresh copy read so an update completed before socket registration is not missed. Retained streams are limited to twenty per copy and one hundred per account. Hidden pages close it but keep the copy already on screen; returning confirms fresh metadata, and a withdrawn copy or a lost connection clears the preview then. Revocation notifications remove the preview immediately. Previously downloaded/rendered copies cannot be recalled.

A separate Durable Object reserves aggregate R2 usage transactionally: 1 GB including per-object margin, 500,000 puts/calendar month, 7.5 million ordinary gets/month and 9.5 million total gets including authenticated management. Failed/uncertain uploads retain their reservation until confirmed deletion. Exhaustion fails closed, without switching to paid operation. These budgets leave room within R2 Standard's included tier for this deployment; other workloads on the same account consume shared allowances. Workers/Durable Objects free request, CPU, duration and storage limits still apply. This is not an unlimited-availability or zero-bill promise for a shared Cloudflare account.

## Verification and deployment

```bash
pnpm test:firebase
pnpm test:firebase:native # desktop-capable host: existing install dialog
pnpm --filter @apx/artifact-worker test
```

Install Firebase CLI, Java and Playwright's Chromium/Firefox/WebKit first. `pnpm test:firebase` builds the panel, viewer and Worker, starts only the demo Firestore emulator on `127.0.0.1:8196`, then runs rules and browser suites. The actual Worker/workerd serves the built assets and headers on `127.0.0.1:7497`, not Vite or Firebase Hosting. Locally generated RS256 keys replace only Google's key transport; the production verifier is exercised unchanged. Each browser case has its own signed demo identity. Core homes and file-backed secrets are isolated; the owner's core is never used. `pnpm typecheck` checks `firebase/` tests as well. Scripted/emulator tests do not prove production Google login, deployment or production revocation latency.

Run the gate before every artifact Worker or rules deployment and retain its output. Deploy only the reviewed rules, preserving account and telemetry policies:

```bash
firebase deploy --config firebase.artifacts.json --only firestore:rules --project apx-agents
pnpm --filter @apx/artifact-worker build
```

The build embeds the fixed viewer as text modules alongside `dist/index.js`: `index.html`, `runner.html`, the versioned JavaScript and CSS (the Firebase Auth chunks are separate and only loaded for sign-in), and the page images (`icon.png`, `apple-touch-icon.png`, `og.jpg`, `logo.svg`) as base64. Upload that script and its `dist/*.txt` modules together as multipart parts to the Workers scripts API, with `main_module: "index.js"` and the configured bindings/migrations. There is no static-assets binding, upload session or assets JWT; Wrangler and Miniflare are local build/test tools only. Source maps are not shipped. The Worker returns the same CSP/sandbox policies, uncached HTML and immutable versioned assets.

Use the existing stored credential reference through the deployment tools, never tokens in chat or committed configuration. The Worker needs its private R2 bucket, `ACCOUNTS` and `BUDGET` SQLite Durable Object bindings, IP rate limit and project binding from `wrangler.jsonc`. Never enable a paid Workers plan automatically. R2 activation may require a subscription checkout/card even for included usage: only the owner may complete it.

Verify the Worker first, then attach only `artifact.apxagent.app` as its custom domain using the approved Cloudflare account/zone. Do not touch the login origin, main site, marketplace or unrelated records. After HTTPS and content/revocation checks pass, stop using the former `apx-artifacts` Firebase Hosting site. Do not delete a live site or migrate production content before inventorying existing publications and obtaining approval for any production data migration.

Spanish: [Infraestructura Firebase y artifacts públicos](README.es.md).
