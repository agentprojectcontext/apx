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
document listener. Use Firestore's memory-only cache and server-only reads for every download; do not import
Firebase Auth, Analytics or persistent offline cache. The SDK is bundled locally rather than loaded from a CDN.
The `@firebase/util` postinstall only supplies environment-derived default app configuration; APX configures the
app explicitly, so its install script is denied in the workspace build allowlist.

## Development

From the repository root, install the frozen workspace lockfile and build `@apx/ui`. Start the Firestore emulator
with `firebase/artifacts-emulator.json`, then run `VITE_ARTIFACT_EMULATOR=1 pnpm --filter @apx/artifact-viewer dev`.
The development app uses a demo project; production builds always use `apx-agents`.

With that separate viewer running, run the retained browser regression tests from the repository root:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8196 APX_ARTIFACT_VIEWER_URL=http://127.0.0.1:7496 \
  node --test firebase/public-artifacts.browser.test.ts
```

The tests use a fresh browser and demo account, never the owner's session. They check selected state, opaque
origin, blocked networking, cookie omission, exact download bytes, live revocation and the download-only fallback
for browsers without credentialless support. Screenshots stay in a temporary directory unless the caller sets
`APX_ARTIFACT_EVIDENCE` to an existing evidence folder. No test requires a core on port 7440.

Docs impact: updated — this README records the design reference, dependency rationale and isolated dev loop.
