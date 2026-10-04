# @apx/mobile

APX on the phone (Expo SDK 57, iOS + Android). It pairs with the owner's core by scanning the QR in Config › Devices
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

While paired it also:
- **Lends the phone to the core as a node** (`location`, `camera`): agents get `phone_location` and `phone_photo`
  only while it is connected. A picture is always taken by the owner (the app shows why it is asked); location asks
  the system's permission once.
- **Registers for push** with its Expo push token, when the app has an EAS project id (`extra.eas.projectId` in
  `app.json`). Without one, paste an ntfy / UnifiedPush address for the device in Config › Devices. Then pick the phone
  in Config › Interruptions › Where notices go: the same budget decides what reaches it.

A core on a VPS or reached through Tailscale: start it with `APX_HOST=0.0.0.0`, an `APX_TOKEN` and
`APX_PUBLIC_URL=https://<its name>` (that address goes first in the pairing QR).

- **Shows the pinned widgets and apps** (Apps button): each opens full screen in a WebView with the panel's strict CSP
  (inline code only, no network, no navigation) and the phone's light or dark colors; a widget's `sendPrompt()` after
  a real touch goes to its thread, as in the panel.
