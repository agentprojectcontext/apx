# Artifact viewer

A separate static operator for public copies, not the APX panel or a protocol client. Firebase Hosting serves
this app at the artifact origin; Firestore enforces document access. It requires neither a running publishing
core nor a cloud function. See `rules/PUBLIC_ARTIFACTS.md` for the data and security contract.

## Design reference

Use APX's minimal/light design and `@apx/ui` (`ApxProvider`, `Button`, `Icons`). Follow the existing artifact
installation dialog and sharing menu in `apps/web/src/surfaces`. The viewer's job is to let someone view one
shared copy and download it to open in APX. It does not expose account management, code input or editing.

Desktop sketch:

```text
+------------------------------------------------------------------+
| APX · Published copy                         [Español / English]   |
| Orders                                           [Open in APX]   |
| Open in APX to review before installing, or download the file.   |
+------------------------------------------------------------------+
|                                                                  |
|                   Sandboxed artifact page                        |
|                                                                  |
+------------------------------------------------------------------+
```

Phone sketch: the same content in one column, title above a full-width download action; the artifact fills
the remaining page width without forcing horizontal scroll. The language switch stays in the top row.
Loading replaces the artifact with one status line. An unavailable link explains that the copy may have
been removed. A connection failure offers Retry; neither error keeps an old iframe or enabled download.
Use sentence case and render title text, never HTML. EN/ES strings belong to this app, not the private panel.

No external font, icon service, analytics or login script is loaded. Shared design tokens supply color,
spacing, rounding and focus. The iframe has its own document and must not inherit the wrapper's UI styles.
The final screenshots still need design review against this reference.

## Dependency reason

Firebase's browser SDK supplies the document listener needed to remove an already-open copy on revocation.
The existing protocol client cannot talk to Firestore, and plain request/response REST cannot provide a live
document listener. Use Firestore's memory-only cache and server-only metadata checks for every download; do not import
Firebase Auth, Analytics or persistent offline cache. The SDK is bundled locally rather than loaded from a CDN.
The `@firebase/util` postinstall only supplies environment-derived default app configuration; APX configures the
app explicitly, so its install script is denied in the workspace build allowlist.

## Isolation and network limits

The execution frame always uses `sandbox="allow-scripts"`, without `allow-same-origin`, and an execution-only
CSP. The `credentialless` attribute is best-effort: browsers that support it also omit credentials on the runner
request; other browsers still show an opaque sandbox preview. On those browsers the initial runner request can
include artifact-origin cookies, but the execution document cannot read them or the wrapper. Keep this origin
separate from login, account and private content; do not put sensitive cookies on it or a shared parent domain.

CSP blocks ordinary fetch/XHR, external scripts, images, frames, workers and forms. This is not a guarantee of
zero network activity or viewer IP anonymity: WebRTC/STUN and browser DNS hints (including `dns-prefetch`) are
not uniformly contained by CSP. Do not preview untrusted copies when those residual disclosures are unacceptable.

## Reads and revocation

The server-confirmed document listener supplies the first metadata snapshot. An initial successful view of an
N-part copy uses N part reads and one final server metadata read, plus the listener's initial read (N + 2). Each
download reuses only previously SHA-256-verified parts in memory and performs two fresh server metadata reads;
it revalidates the assembled bytes, schema and hash. It never rereads parts just to download the same revision.
A listener update fetches the new parts, while revocation, lost connectivity, listener errors and deadlines clear
the preview and invalidate in-flight downloads. Listener updates, reconnects and rule-dependent reads can add
billable reads; these counts are successful-path document reads, not a quota guarantee. There is no persistent cache.

## Explicit Firebase configuration

There is no implicit production project. Set `VITE_ARTIFACT_FIREBASE_PROJECT` explicitly for every dev server
and build. A real project cannot use `VITE_ARTIFACT_EMULATOR=1`; a `demo-*` project requires it. Missing or mixed
configuration fails the build. The Hosting config uses the `artifacts` target instead of a hard-coded site.
Before any future authorized deployment, bind that target explicitly for the selected project, verify the built
project id and deploy with an explicit `--project` and `--only hosting:artifacts` scope. This does not create a
project, migrate documents, enable billing or deploy rules. Core publishing and anonymous installation reads
must use the same selected Firestore project; changing the viewer alone does not migrate the publishing service.
Core's `APX_ACCOUNT_CLIENT` must match that target and its Firebase Auth configuration. An existing F3 ID token
cannot authorize Firestore in a different Firebase project: cross-project token audiences are rejected. A truly
separate login/artifacts project needs its own authenticated session; a project-id override is not an auth bridge.

## Development and browser regression

Install the frozen workspace lockfile and build `@apx/ui`, then build the demo viewer:

```sh
VITE_ARTIFACT_FIREBASE_PROJECT=demo-apx-artifacts VITE_ARTIFACT_EMULATOR=1 \
  pnpm --filter @apx/artifact-viewer build
```

Serve this **built output with Firebase Hosting on 7497**, alongside Firestore on 8196, using a temporary demo
configuration derived from `firebase.artifacts.json`. The emulator configuration must bind the target to a demo
site, use a public path relative to its configuration file, load `firebase/firestore.rules`, and add only
`http://127.0.0.1:8196` to the wrapper's `connect-src`. Never add that exception to the production configuration.
Keep the remaining headers and rewrites unchanged. The regression checks real Hosting responses, not Vite:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8196 APX_ARTIFACT_VIEWER_URL=http://127.0.0.1:7497 \
  node --test --test-concurrency=1 firebase/public-artifacts.browser.test.ts \
  firebase/public-artifact-preview.browser.test.ts
```

The public-viewer tests reject other URLs. They check wrapper/runner CSP separation, no-store documents,
immutable hashed assets, selected state, opaque origin, blocked ordinary networking, credential omission when
supported, exact downloads, live revocation and previews without credentialless support. The separate private
preview regression uses a local private-host fixture, not Vite, because it exercises the panel's srcdoc preview.
Screenshots stay in a temporary directory unless `APX_ARTIFACT_EVIDENCE` names an existing evidence folder.
No test uses the owner's session or requires a core on port 7440.

Docs impact: updated — this README records explicit configuration, read counts and network limitations.
