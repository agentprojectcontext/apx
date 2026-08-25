# Desktop module (floating voice window)

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read before touching the Electron
> capsule. It honors the `overlay`→`desktop` shim (rule **5** in the hub).

`apx desktop` — tray-resident Electron capsule (hotkey ⌘G/Ctrl+G), renamed from `apx overlay` (rule 5). Lives in `src/interfaces/desktop/` (`main.js`/`preload.js`/`renderer.js`, vanilla JS — NOT React), wired by `plugins/desktop.js`, `desktop-ws.js`, `api/desktop.js`.

- **Boot:** `apx desktop start` → `commands/desktop.js` (`findElectron()` cascade; for autostart the `node node_modules/electron/cli.js` branch wins under launchd's minimal PATH). Wrapper spawns Electron `detached`+`unref`. `main.js` reads `desktop.*` config, registers shortcuts, connects WS to `/api/desktop/ws` **with a bearer token** (the upgrade handler authenticates it — see `desktop-ws.js`).
- **State machine** (renderer): `idle | listening | transcribing | thinking | speaking`. Non-streaming models send one `done` with no tokens → inject final text immediately; TTS is fire-and-forget. Production guards (double-`done`, regen, conv-card height, webm chunked transcription) are documented inline in `renderer.js` — read the comments before touching it.
- **Identity name:** `identity.json agent_name` → `super_agent.name` → `SUPERAGENT_DISPLAY_FALLBACK` ("APX", `core/identity/self.js`) via `resolveAgentName()`; don't invert.
- **Mascot notifications:** `desktop.mascot_sound` defaults to `true`. Each new-message bubble plays `assets/notification.mp3`; the tray and mascot right-click menus expose a checked **Sonido de mensajes** toggle. Keep sound preference independent from `desktop.mascot` visibility.
- **Mascot avatar:** `super_agent.icon` selects one of the shared blob presets. The authenticated events feed sends the current avatar in `hello` and hot changes in `settings`; repaint the mascot window without restarting Electron.
- **Autostart** (`apx desktop install/uninstall`): launchd plist / HKCU Run / `.desktop`. `ProgramArguments` MUST be `process.execPath` + absolute CLI script (never a shim — launchd PATH ENOENTs `exec node`).
- **Out of scope:** `apx voice` (CLI TTS) and `voice.*` keys; whisper/STT (`transcription.js`). The desktop is a consumer, not an owner.
