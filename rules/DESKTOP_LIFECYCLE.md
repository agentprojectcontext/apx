# Desktop and daemon lifecycle

## Ownership

The daemon is the only state owner. An installation is identified by its canonical state home (`APX_HOME`, default
`~/.apx/v2`), not by its port, executable or Desktop window. The production entry acquires an exclusive SQLite lock
in `<home>/daemon-lock.sqlite` before opening core state. Another daemon for that home fails even on another port.
A separate `<home>.startup/daemon-lock.sqlite` lock serializes legacy-home migration before the state directory is
created; it is released after the daemon lock is acquired. The OS releases ownership on exit or crash.
Never remove either lock file while a daemon may be running. Use a local
filesystem with working SQLite locks; sharing a home across computers or network filesystems is unsupported.

Desktop and the daemon can live on different computers:

| Entry | Target | Lifecycle authority |
|---|---|---|
| Desktop, local choice | Loopback, port from `APX_PORT`, then `<home>/core.env`, then 7440 | May supervise its bundled child only |
| Desktop, URL choice or `APX_URL` | Explicit HTTP(S) origin, including explicit loopback URLs | Connect only; no fallback spawn |
| Desktop, SSH choice | Explicit host through a local tunnel | Tunnel only; server installation is a separate explicit action |
| `apx service …` | This computer's service manager and selected home | Never a remote daemon or Desktop |
| `apx desktop` | Desktop app on the computer running the command | Does not open another computer's Desktop |
| `apx open`, ordinary RPC commands | `APX_URL` / explicit protocol target | Protocol operations, not OS service control |

Desktop checks the local daemon's `system.health.home_id` against `<home>/home-id` before loading its panel or
lending local capabilities. A different home answering on the selected port is an error, not an adoption. Existing
same-home daemons are connected to, not stopped on app quit. Version differences do not authorize replacing a
service; inspect `apx status` (`code_sha`) and update the intended installation explicitly.

When Desktop starts its own bundled daemon, it passes home and port explicitly and does not inherit an unrelated
`APX_APP` bundle location or code SHA. Ambient `APX_*` variables are removed from the child environment; the
bundled child binds explicitly to `127.0.0.1`. Its selected home's `core.env` supplies persisted settings such as
the token, but cannot override that loopback binding. Closing the window hides it. Quitting the app stops its own child, not a
service or a remote daemon. Stopping cancels pending restart timers; a replacement waits for the previous child to
exit. Updating Desktop updates its bundle only. Updating a server from its panel remains an explicit server action;
restarting the client does not implicitly update that server.

## Desktop installation from a local web panel

`desktop.install_status`, `desktop.install` and `desktop.install_cancel` use the ordinary protocol router. All three require a human and a direct
loopback request; locality is checked before idempotency replay or joining another request. HTTP and WS derive
locality from the actual peer, Host, Origin and proxy headers, never request parameters. A graphical session is
also required; SSH sessions and headless Linux do not offer this action. A transparent SSH forward cannot be
distinguished from a direct connection: the notice explicitly says installation happens on the computer hosting APX.

The shared Node-only installer in `packages/install` streams a bounded release asset, verifies its required SHA-256,
installs in the user's application folder and launches the app. macOS uses the release zip rather than a DMG drag
step; Windows runs NSIS and Linux installs the AppImage and a desktop launcher. The OS may still require permission
for an unsigned app; installation does not remove quarantine or bypass OS security. Polling resumes after a web reload;
errors allow retry. After the start request is acknowledged and while the download is in progress the panel can cancel it: the transfer aborts and the notice returns to idle, without a failure. Minimizing the notice keeps its compact progress indicator visible while the download continues; a failure expands it again. Closing the offer is remembered across reloads, with an install action left above the sidebar account. After installation, that action becomes Open desktop and the install notice stays hidden. Installing and opening are not cancelled. A core restart interrupts the download; the next visit offers installation again.

The explicit install action saves a private, atomic local connection containing canonical home, port and home id,
without tokens. Desktop validates the home identity and reads its credentials from that home's `core.env`. If the
active token came only from the environment, the explicit install action first saves it privately in `core.env`,
preserving the other settings. The saved local target survives app restarts. An already running app receiving the local-adoption launch flag relaunches to read
the saved target. It does not uninstall, restart or replace an existing daemon service or move domain data.

A fresh graphical `install.sh`/`install.ps1` installation opens desktop setup without registering a service. Server
mode is explicit (`--server` / `-Server`), automatic when headless, and retained for existing server installations.
`--file` and `--no-service` remain server bundle operations. Desktop's SSH installer always passes `--server`.

## Local services

`apx service` prints its local target. `APX_URL` never redirects service status, installation, restart, removal or
logs to a server. `--home` selects the state home for every service subcommand. New service definitions persist the
home and port, so a login manager's environment cannot silently select another installation.

The default home retains `apx.service`, `dev.apx.core` and `APXCore`. Custom homes use a stable home-hash suffix,
so restarting or uninstalling one cannot address the default installation's service entry. Existing entries must
match the selected home before modification. Windows stop/restart does not trust persisted PIDs: it identifies the
supervisor by the exact quoted home argument and restricts core termination to its direct child.

### Older custom-home services

Older versions used the fixed default service name even for a custom home. If that entry belongs to the selected
custom home, commands stop with a diagnostic naming it, including `status`; they do not hide it as "not installed"
or silently replace it. Inspect the entry and its home, stop and remove that specific entry with the OS service
manager, then run `apx service install --home <home>` to create the home-specific entry. Keep the state directory.
Do not remove an entry belonging to another home. This is an explicit operator repair, not automatic config migration.

## Verification and rollback

Focused tests cover lock contention, aliases, independent homes, crash release, connect-only URL selection,
home identity checks, explicit child target, stop during restart backoff, service identities and ownership checks.
An isolated real-process check also starts the production entry, rejects a second daemon on another port, kills
and restarts the first, and checks clean shutdown. Packaged Desktop quit/update and OS service-manager execution
must additionally be exercised on each supported OS before release.

Rollback: stop the supervisor for the affected installation before reverting. Custom-home service entries created
by this version must be removed using this version before downgrading to a fixed-name-only CLI. Never delete the
state home or lock file to force a second daemon to start.
