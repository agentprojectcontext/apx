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
firebase emulators:exec --config firebase/firebase.json --only firestore --project demo-apx-account 'node --test firebase/account.rules.test.ts firebase/telemetry.rules.test.ts'
node --test apps/core/src/account/session.test.ts apps/core/src/rpc/account.test.ts apps/desktop/src/main/account-return.test.ts
```

Use an isolated core with `APX_SECRETS=file`, a temporary `APX_HOME` and a port other than the owner's core. Emulator/scripted-provider tests do not prove a live Google sign-in or production rules deployment.

Deploy only the reviewed rules, preserving the existing telemetry rules, with `firebase deploy --only firestore:rules --project <project>`. This changes access control for the project; inspect the diff and run both emulator suites first. No billing upgrade is part of account setup.

Spanish: [Configuración de Firebase](README.es.md).
