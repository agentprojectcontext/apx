# APX in Chrome

Development preview. [Español](README.es.md).

A Manifest V3 extension named **APX** opens APX's existing quick chat in Chrome's side panel. The conversation, model picker, new chat action and approvals are the actual APX web interface, not another agent service or a simulated chat. It uses your configured APX model providers; it does not require Claude Code or Codex.

## Build and load

Requires Chrome 116+, Node 24.11+, repository dependencies and a running APX core serving its built web panel.

```bash
pnpm build:chrome-extension
```

Load `apps/chrome-extension/dist` using **Load unpacked** at `chrome://extensions`, with developer mode enabled. Pin APX or select it from Chrome's extensions menu, then click it to open the side panel. No native messaging host is installed. The extension requires only the `sidePanel` permission; it cannot read or operate the current website.

A compact recovery strip follows the browser's system colors and preferred language (English or Spanish). The chat keeps APX's own appearance and language preferences; the wrapper does not read or synchronize them across origins. The model button stays compact; open its menu to read complete model names and references, including at narrow panel widths. **Home** is APX's existing name for the main conversation in both languages, not the owner's name or an agent name.

The default destination is `http://127.0.0.1:7440/?quick`. For a different local APX port, rebuild with:

```bash
pnpm build:chrome-extension --port 7441
```

Reload the extension in Chrome after rebuilding. Only a numeric port is accepted; remote addresses, credentials and configurable URLs are not supported.

For the Chrome Web Store, build the upload zip with `pnpm build:chrome-extension --store`. It is written to `out/apx-chrome-extension-<version>.zip` and has the same files as the unpacked build, without the manifest `key`: the store refuses one on a new item and signs the package with its own.

If APX asks to pair, use its normal pairing flow: run `apx pair` on the computer running that core and enter the code **inside the APX screen**. The extension has no token field. Pairing grants this APX web client the owner's normal access; it is not a restricted browser capability. It can request the same agent actions and approvals as APX opened in a normal tab. Browser storage for the embedded panel may be separate from a normal APX tab. If your browser blocks its storage, pairing will explain that it could not save the connection; use **Open APX in a tab** instead.

## If the panel does not open

- Keep APX running and confirm its normal browser panel opens at the selected local address.
- Use **Reload** after starting APX or recovering the connection. It reloads the chat, so an unsent draft may be lost.
- **Open APX in a tab** opens the same quick chat outside the side panel.
- Open **Help** for recovery instructions if the panel stays blank or Chrome shows a failed-frame page. The wrapper cannot reliably distinguish a failed cross-origin frame from a slow or still-loading APX page, so it does not infer an error from a timeout. Reload actually reloads the frame; Escape closes the help.
- If a loaded chat loses its connection, its presence dot turns gray and **Not connected to APX** appears with **Retry**. The composer stays disabled until the connection is restored, and its model control says **Unavailable** rather than suggesting no models are connected. When connected with no configured models, the compact control says **No models**; its menu explains how to connect one without unused search, routing or effort controls. **Choose automatically** uses APX's existing model selection and fallback settings.
- Model availability, errors, streaming, approvals and reconnect behavior are provided by APX itself. The extension does not add a provider, sign in to one or configure one.

**New chat** opens APX's searchable agent picker, including your super-agent and agents grouped by project. Search by agent name, role or project; recent agents appear first with their project. Selecting an agent opens a draft in this panel with that agent's project and model settings. Opening or dismissing the picker does not replace your current conversation or create a saved chat; the first message creates it. Model overrides remain specific to their conversation. The header shows the selected agent and project; use **Back to Home** to return to the main conversation. The same picker is available in the desktop quick-chat window. The `/new` command starts a fresh conversation with the current agent and project inside this panel. If you switch conversations while a first message is being sent, its completion does not switch you back, even if you have returned to a new draft for the same agent.

This first scope does **not** share tabs, create tab groups, inspect the page, handle browser logins, or connect a browser node. Voice input, external sign-in popups and downloads inside the embedded panel have not been verified; use APX directly for those paths.

## APX logo

The toolbar, native side-panel header and extension management screen use APX's official transparent green logo. The bundle includes 16, 32, 48 and 128 px PNGs generated from the existing web favicon, without a new design or extra permissions. To regenerate them, run `node apps/chrome-extension/generate-icons.ts`; see `assets/README.md` for the source and generation details. Reload the extension after rebuilding to refresh Chrome's icons.

## Stable unpacked identity

The bundle includes a public RSA/SPKI `manifest.key`. Its exact Chrome ID is **`pfpnbpijklnekfbnpgbohlmmmfljmklf`**, independent of the folder or local APX port. The corresponding origin is `chrome-extension://pfpnbpijklnekfbnpgbohlmmmfljmklf`; use only that exact origin where a separately reviewed core framing policy permits this preview. No wildcard or additional RPC trust is implied.

Only the public key is kept in `identity.ts`. The private key was generated in memory and discarded, not stored or committed. This pins an unpacked development identity; it is **not authentication or proof of authorship** because another locally loaded extension can copy the public manifest key. This is not a Chrome Web Store signing identity. Publishing or replacing it requires a separately coordinated identity/policy migration.

## Security boundary

The extension page frames one exact loopback origin. APX's frame calls the existing protocol from its own origin and retains the existing authentication/approval gates. The extension does not make protocol requests, change origin controls, register a node, store tokens, receive frame messages, inject scripts, or inspect that frame's DOM. Its CSP forbids direct connections and allows only the compiled local frame origin. The frame is a normal trusted APX web client, not an isolated or least-privilege agent sandbox. Same-origin protection separates it from the extension wrapper; this is not protection against an OS compromise or an altered extension/package.

The core-served panel sends `frame-ancestors 'self' chrome-extension://pfpnbpijklnekfbnpgbohlmmmfljmklf`, restricting framing to its own origin and this exact extension origin. This is clickjacking mitigation, not authentication: a locally loaded unpacked extension can copy the public key and origin. The Vite development server serves its own HTML and does not receive this core header; do not treat it as protected by this policy. This preview is not yet approved for a daily browser profile. The earlier `examples/chrome-browser-node` laboratory is separate and is not bundled or required.

## Verification

```bash
pnpm build:web
pnpm exec tsc -p apps/chrome-extension --noEmit
pnpm test:chrome-extension:browser
```

Tests load the generated MV3 bundle in a disposable Chromium profile and use a real scratch core with random port/home/token and neutral data. They exercise normal code pairing, model selection persisted through APX, chat through its engine using an **explicitly scripted test model**, reload, same-origin isolation and connection denial from the wrapper. The pnpm runner restricts the child process PATH to operating-system directories; the fixture refuses to start a core if Claude Code or Codex can be discovered there. This prevents model-catalog discovery from starting the developer's installed agent CLIs. Use the pnpm command rather than invoking the test file directly. Tests never connect to the daily core or import a browser login. This is not evidence of a paid/remote provider invocation. The test opens the actual extension document at panel dimensions; Chrome's toolbar-to-side-panel interaction and platform-specific UI still need independent runtime/design review before delivery.

Docs impact: updated — this page and its Spanish counterpart document loading, connection, permissions, troubleshooting and remaining scope.
