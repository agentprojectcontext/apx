# @apx/mobile

APX on the phone (Expo SDK 57, iOS + Android). It pairs with the owner's core by scanning the QR in Settings › Connections › Devices
(or an `apx://pair?…` link, or the address and code typed by hand), keeps its own key in the system's secure storage,
and shows the super-agent's chat (Home) live over the socket. Revoking the device in the panel sends it back to
pairing.

It installs on its own, outside the pnpm workspace, so React Native never weighs on the core's or the panel's install:

```bash
cd apps/mobile
npm install
npm run typecheck && npm test        # types, and the pure pairing logic (node:test)
npx expo start                       # Expo Go or a dev build; the core must listen on the network:
                                     # APX_HOST=0.0.0.0 APX_TOKEN=… pnpm dev (or reach it through Tailscale)
```

It reads the protocol's client from `packages/protocol/src` (no zod reaches the phone: the core validates).
The native adapter injects `expo-crypto` UUIDs: Hermes does not provide the browser's global Web Crypto API.

While paired it also:
- **Lends the phone to the core as a node** (`location`, `camera`): agents get `phone_location` and `phone_photo`
  only while it is connected. A picture is always taken by the owner (the app shows why it is asked); location asks
  the system's permission once.
- **Registers for push** with its Expo push token, when the build has an EAS project id (`APX_EAS_PROJECT_ID`, see
  [Push](#push)). Without one, the owner gives the phone an ntfy address in the panel. Then pick the phone in
  Config › Interruptions › Where notices go: the same budget decides what reaches it.

A core on a VPS or reached through Tailscale: choose Tailscale in Settings › Connections › Devices, or run
`apx expose tailscale` on that server and restart the core. Tailscale Serve forwards the tailnet's HTTPS address to
the core on loopback; `apx pair` creates the one-time code. Network settings always belong to the core's machine.

- **Keeps the board and the routines**: a task opens its page (title, description, column, priority, who does it, due
  date, project, type, waiting for the owner), closes as done or dropped (a commitment as kept, missed or released),
  reopens, and shows its history; the Tasks tab writes new ones. A routine's page edits its name, prompt, agent,
  schedule and commands, turns it on or off and runs it now.
- **Shows the pinned widgets and apps** (Apps button): each opens full screen in a WebView with the panel's strict CSP
  (inline code only, no network, no navigation) and the phone's light or dark colors; a widget's `sendPrompt()` after
  a real touch goes to its thread, as in the panel.

The unpaired screen shares the web gate's dark design, QR scan, manual address/code fields and notification status.
Revoked credentials return to pairing on the next launch; an unreachable core keeps the existing pairing for offline use.

## Design and UI kit

The screens follow the APX Mobile design (the panel's minimal look, dark mode). Colors and radii come from
`packages/ui/src/styles/tokens.css` through `npm run sync:design`, which writes `src/ui/tokens.ts` along with the
icons, blob eyes, engine marks, the panel's routine slot logic (`src/routines/slots.ts`, `cron.ts`) and the board's
due dates and task history (`src/tasks/when.ts`, `history.ts`); never edit
those files by hand. Screens are built from `src/ui/kit` (buttons, chips, tags, cards, list groups, the switch,
segmented control, spinner, headers, bottom sheet, tab bar), so a style changes in one place. Every word on screen
goes through `src/i18n` (English, Spanish).

Metro watches files only outside CI mode: start it without `CI=1`, or saved changes never reach the phone.

## Native notifications

Android creates a high-importance `default` channel before requesting notification permission. Unread
`notification.updated` events produce native notifications while the live connection runs. A notification opens
its conversation; duplicate updates of the same notice do not create additional alerts. News about the chat on
screen stays quiet (opening a chat also clears its notifications from the tray), and a notice read elsewhere leaves
it. A remote push carrying `data.thread_id` opens its chat the same way. Settings shows the delivery
status and provides a local notification preview.

Local permission does not guarantee delivery after the OS suspends or closes the app: that needs push (below).
Select the paired device as the destination in the core's interruption settings. Missing configuration is displayed
explicitly; no permanent background service is started.

## Push

Two ways reach a phone whose app is closed. Settings on the phone says which one is active.

**ntfy, today, no account.** The core posts each notice to an ntfy topic and the ntfy app on the phone shows it;
tapping it opens APX on its chat (`apx://open?t=<thread>`).

1. Install ntfy on the phone (Play Store or F-Droid) and subscribe to a long random topic, e.g.
   `apx-<20 random letters>` on `ntfy.sh`. The topic name is the only key: whoever knows it reads the notices. A
   self-hosted ntfy keeps the text off the public server, and has no daily limit (ntfy.sh's free tier caps what one
   core may send).
2. In the panel: Settings › Connections › Devices › the phone › Set up notifications, paste `https://ntfy.sh/<topic>`,
   Use for push.
3. Config › Interruptions › Where notices go: the phone.

**Expo push, once the owner has the accounts.** The app registers its Expo push token by itself; the core sends to
Expo's service with no credential of its own. A build needs two values, both read by `app.config.js` from the
environment (never committed):

| Variable | What | CI |
|---|---|---|
| `APX_EAS_PROJECT_ID` | the EAS project's id | repo variable `APX_EAS_PROJECT_ID` |
| `APX_GOOGLE_SERVICES_FILE` | path to the Firebase app's `google-services.json` (Android needs FCM) | repo secret `ANDROID_GOOGLE_SERVICES_JSON_BASE64` (the file in base64) |

Owner steps, once:

1. Expo: sign in (`npx expo login`, free account), then in `apps/mobile` run `npx eas-cli@latest init` and create the
   project. It prints the project id (a UUID); with a dynamic config it does not write it anywhere. Save it as the
   repo variable `APX_EAS_PROJECT_ID` (GitHub › Settings › Secrets and variables › Actions › Variables).
2. Firebase: in the console create a project, add an Android app with package `dev.apx.mobile`, download
   `google-services.json`, and save `base64 -i google-services.json` as the repo secret
   `ANDROID_GOOGLE_SERVICES_JSON_BASE64`.
3. FCM for Expo: Firebase › Project settings › Service accounts › Generate new private key; upload that JSON with
   `APX_EAS_PROJECT_ID=<id> npx eas-cli@latest credentials -p android` from `apps/mobile` (the id is not in app.json;
   `eas.json` is there only for this command) › Google Service Account › FCM V1 (or on expo.dev ›
   the project › Credentials). Keep Expo's "enhanced push security" off: the core sends without an access token.
4. iOS later: an APNs key through `eas credentials` (needs the Apple Developer account).
5. The next tag builds an APK that registers for push; Settings on the phone says "Push service registered".

Set both or neither: a project id without the Firebase file makes Android refuse the token (Settings shows the error).

## Release build

CI (`release.yml`, job `android`) runs `expo prebuild` and `./gradlew assembleRelease`, signed with the repo's key.
`app.config.js` derives from `app.json`'s version (set from the tag):

- **versionCode** `major*10000 + minor*100 + patch` (2.0.10 → 20010), so each release installs over the one before
  (minor and patch stay under 100). iOS's build number is the same.
- **ABIs**: arm64-v8a only (42 MB instead of 106 MB with all four). `APX_ANDROID_ABIS=armeabi-v7a,arm64-v8a,x86_64`
  builds others, locally or in CI (the workflow's `android_abis` input, or the repo variable `APX_ANDROID_ABIS`).

```bash
npx expo prebuild --platform android --no-install && (cd android && ./gradlew assembleRelease)
```
