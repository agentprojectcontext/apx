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
- **Registers for push** with its Expo push token, when the app has an EAS project id (`extra.eas.projectId` in
  `app.json`). Without one, paste an ntfy / UnifiedPush address for the device in Settings › Connections › Devices. Then pick the phone
  in Config › Interruptions › Where notices go: the same budget decides what reaches it.

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

Local permission does not guarantee delivery after the OS suspends or closes the app. Remote Expo push requires
an EAS project ID, Android FCM configuration (`google-services.json` in the native build and FCM v1 credentials in
EAS), and APNs credentials for iOS. Select the paired device as the destination in the core's interruption settings.
Missing configuration is displayed explicitly; no permanent background service is started.
