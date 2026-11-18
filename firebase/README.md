# Firebase account backend

APX accounts use Firebase Authentication (Google) and Firestore REST. They do not require Cloud Functions or a billing-enabled Firebase plan. Free quotas still apply; quota exhaustion makes account operations unavailable without disabling local APX work.

## Configuration

Enable Google in Firebase Authentication and create a Firebase web app. Use the existing Google **Desktop app** OAuth client for the installed-app authorization flow. The Firebase API key and desktop client identifier are public application configuration, not an authorization boundary. Never package administrator credentials or service-account keys.

Supply `APX_ACCOUNT_CLIENT` as JSON with `project` and `apiKey`, or package `account-client.json` at the core root. Supply the desktop Google client using APX's existing `APX_GOOGLE_CLIENT` configuration or packaged `google-client.json`. Distribution builds inject these through the existing staging scripts. Do not commit local configuration files.

The core requests only `openid email profile` with PKCE S256 and a random, expiring state. Google returns to `http://127.0.0.1:<core-port>/oauth/account`. The return page calls the registered `account.finish` protocol method; desktop returns the code through `apx://account/callback` before completing that method. No second HTTP authentication handler is introduced. Firebase validates the Google ID token through `accounts:signInWithIdp`; renewal uses Secure Token's refresh endpoint.

This loopback flow requires the browser and core on the same computer. A phone browser or browser on a different computer cannot reach the core through that address. It does not provide remote sign-in; an HTTPS broker would be a separate deployment and cost decision. A local build must serve the built panel to render the return page.

## Data and security

- `users/<Firebase UID>` contains the private profile: eight-character ID, name, photo and optional handle.
- `accountIds/<code>` reserves an immutable user ID; `accountHandles/<handle>` reserves a unique handle.
- Atomic Firestore commits create the profile and reservation with `exists: false` preconditions. Conflicts retry without overwriting another account. Renames compare the profile revision, reserve the new handle and release the old handle in one commit.
- Rules use `getAfter` to require matching profile/reservation writes. People cannot list profiles, read another profile, change their ID or keep an obsolete handle reservation.
- The core stores Firebase ID and refresh tokens together only in its secret store. Account protocol results contain no tokens. Account methods are owner-only; agents cannot inspect the session. Sign-out deletes this core's secret, not the cloud profile or sessions on other cores.
- Account IDs are not public artifact codes. Public artifact links use an independent code for each artifact; account creation publishes nothing.
- Telemetry remains separate: anonymous writes retain their existing validation; private reads require `telemetry_reader: true`. Ordinary Google accounts gain no telemetry access. Keep the telemetry rules when deploying account rules.

## Emulator regression tests

From the repository root:

```bash
pnpm test:firebase
pnpm test:firebase:native # desktop-capable host; checks the existing installation dialog
node --test apps/core/src/account/session.test.ts apps/core/src/rpc/account.test.ts apps/desktop/src/main/account-return.test.ts
```

Install Firebase CLI and Java, then run `pnpm exec playwright install chromium firefox webkit` before the gate. `pnpm test:firebase` builds the panel
and viewer, starts Firestore on `127.0.0.1:8196` and Hosting on `127.0.0.1:7497`, then runs the account, telemetry,
artifact rules and browser suites sequentially. Viewer tests use Hosting's actual headers, not Vite. The command
uses demo projects and isolated core homes with file-backed secrets; it never needs the owner's running core.
`pnpm typecheck` also checks every TypeScript test in `firebase/`. Native installation has its own desktop command
because it launches Electron. Emulator/scripted-provider tests do not prove live Google sign-in or deployment.

Before every rules or artifact Hosting deployment, run `pnpm test:firebase` and keep the output with deployment
evidence (see `rules/RELEASE.md`). Deploy only reviewed rules, preserving the existing telemetry/account policies,
with `firebase deploy --config firebase.artifacts.json --only firestore:rules --project <project>`. The gate is mandatory, not part of normal
preflight. No billing upgrade is part of account setup.

## Optional quota isolation (owner decision)

No separate Firebase project is created by this change. The current project shares Firestore quotas between
accounts, artifacts and telemetry; a popular public link can still consume that shared free quota. The viewer
now uses a listener-confirmed initial revision, reuses only hash-verified parts for downloads, and ships hashed
assets with immutable caching. Metadata/part reads no longer inspect private owner/slot documents in rules.
These reduce ordinary reads; they do not provide abuse protection or unlimited availability.

If the owner chooses a new free project:

1. In Firebase Console, create a **Spark** project without upgrading billing, create its Firestore database and
   Hosting site, and enable Google Authentication. Configure the desktop Google OAuth client for that project as
   described above. Pick the database location before creating it; this cannot be changed in place.
2. Configure the core's public `APX_ACCOUNT_CLIENT` with that project's `project` and `apiKey`, and the matching
   Google desktop client through `APX_GOOGLE_CLIENT`. Set `VITE_ARTIFACT_FIREBASE_PROJECT=<project>` when building
   the viewer, without `VITE_ARTIFACT_EMULATOR`. Existing accounts/documents are not migrated by these settings.
3. Run `pnpm test:firebase`, review the rules, bind the Hosting target with
   `firebase target:apply hosting artifacts <site> --project <project>`, and explicitly deploy only the reviewed
   `firestore:rules,hosting:artifacts`. Add the artifact custom domain in Hosting, then change only its approved DNS
   records. Do not change the login origin, telemetry configuration or enable billing as a side effect.
4. Verify sign-in, publish/update/revoke, public viewing and installation against an isolated core before moving
   any live account. Rebuild recipient clients with the same public target configuration; links carry only codes.

This supported configuration moves the optional account and artifacts together; telemetry can remain in its
original project. It does **not** split artifacts from F3 authentication/profile quotas. Firebase ID tokens are
project-scoped: an original-project token cannot authorize writes in a different project. Keeping F3 login in
its original project while artifacts use another requires a separately authenticated session in the artifact
project (not just a project-id override); that auth bridge is not implemented or deployed here.

Spanish: [Configuración de Firebase](README.es.md).
