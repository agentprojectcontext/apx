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
Next: the phone as a node (camera, notifications), push, and the panel's surfaces in a WebView.
