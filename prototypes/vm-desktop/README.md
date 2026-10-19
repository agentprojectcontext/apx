# VM desktop prototype

An opt-in APX desktop experiment with a real Debian VM, Xfce, Chromium and a terminal. Runtime data uses a separate scratch home. The worktree contains code only; no personal APX data is imported.

Requires macOS Apple Silicon and Node 24. Lima is reused if compatible or installed privately on demand. The pinned image is verified by Lima. No host folders or SSH agents are shared. Commands and desktop apps run as an unprivileged worker, separately from the Lima administrator. Root-owned guest rules block direct external IPv4/IPv6 traffic. HTTP(S) uses a host-owned proxy that rejects private/special addresses and current host interfaces/networks, validates every DNS answer and pins the dialed IP. No host-wide firewall changes are required. This is a VM boundary, not protection against guest kernel or hypervisor exploits.

VM work happens in `/home/apx-worker/work`; screen connections are human-only and authenticated through short-lived single-use core tickets bound to the issuing device. Default mode uses a local scripted fixture and makes no model API calls. Real-agent mode uses the normal APX native loop and provider selector, including its own ChatGPT sign-in. The model runs in the host core; shell and Chromium run inside the guest. Credentials stay in the separate core home, never in the VM.

## Run

```sh
pnpm install --frozen-lockfile
pnpm vm:prototype $HOME/.apx/v2/labs/apx-vm-lab-demo
```

The launcher opens APX without starting or downloading a VM. In Computer, choose **Enable computer** to download missing components and provision the pinned Debian image, Xfce, Chromium and TigerVNC. The command builds this checkout and opens **APX VM Lab**, a separate Electron app with its own data directory, core database and ephemeral port. It never imports the owner's chats, model logins, browser profiles or channels. The default lab runtime persists under `~/.apx/v2/labs/apx-vm-lab-demo`, separately from the main office. A system restart keeps its disk, chat and lab-only sign-in; an explicitly chosen `/tmp` runtime is temporary. Initial setup needs Internet; subsequent start reuses the existing named VM. Keep runtime paths short for SSH sockets. Closing the panel leaves Linux running; **Shut down VM** stops it and releases its memory. **Start VM** reuses the existing disk.

Open the home chat's **Computer** panel. Ask the agent through the chat. The desktop is read only while the agent owns control. **Take control** cancels its active turn and guest command, fences delayed browser inputs and persists an interruption notice. The current browser stays open. **Return control to agent** makes agent work available again; it does not resume the canceled turn.

The terminal has an editable multiline shell-command draft, accumulated output and a Send button (Ctrl/⌘+Enter). Drafts can be edited during execution. Commands run only under manual control, in a fresh shell in `/home/apx-worker/work`, with a 45-second limit. Drag the separator or use its arrow keys to resize; header controls minimize, maximize and restore without disconnecting the desktop. An interactive shell remains available on the VM desktop.

The Computer panel can be widened. Switch APX's language through its normal language control. The header’s close button hides Computer and closes its display stream; it does not stop the VM or its running work. Reopen it from a guest browser reference or the chat’s Computer button. Stop the launcher with Ctrl+C, then stop just this VM:

```sh
LIMA_HOME=$HOME/.apx/v2/labs/apx-vm-lab-demo/lima limactl stop apx-lab
```

The directory contains the VM disk, scratch core/desktop data and `running.json` with the local URL and revision. Keep or delete it as a unit only after stopping its processes. The worktree itself contains no runtime data.

## Appearance and resources

The desktop follows APX’s resolved light/dark appearance, using matching APX wallpapers, emerald GTK/window frames and terminal colors. Changing APX appearance while Computer is open synchronizes it; reopening applies the current choice. Custom owner wallpapers survive theme changes. The theme reuses installed Xfce frame artwork and GTK's built-in dark base; it adds no packages or background services. Later starts preserve custom wallpapers. To deliberately restore the bundled defaults inside the guest, run `/usr/local/bin/apx-appearance light --reset` (or `dark`). GTK-specific stylesheet assets use `.gtk` and are installed as `gtk.css`; they are not web CSS.

The regular core exposes the same optional lifecycle. The public installer carries the controller and small desktop assets, but installs no VM or virtualization runtime up front. Only an owner’s **Enable computer** action can start installation; agents cannot enable, stop or change appearance themselves. Missing Lima is downloaded from a pinned official archive, checked with SHA-256 and installed privately without root or Homebrew. Only its native driver, Linux ARM guest agent and license are extracted. Docker and containerd are disabled. The current backend supports macOS Apple Silicon only.

The guest has 2 virtual CPUs, 4 GiB RAM and a sparse 24 GiB virtual disk. Before starting, the VM disk volume must have 26 GiB free: the full guest disk plus 2 GiB reserve. The check uses that volume, including when the lab lives on a separate drive. It conservatively budgets sparse-file growth without relying on shared filesystem extents. This is an admission check, not a physical disk reservation; other host processes can still consume free space later. One measured session with Chromium open used approximately 1.7 GiB inside Linux; the Lima runtime occupied 2.6 GiB on the host. These are observations, not guaranteed limits or compressed download sizes. The 4 GiB VM allocation and host-app memory must both fit; 16 GiB host RAM is a reasonable initial target, not a tested minimum. Closing Computer only disconnects the viewer. Stop the VM to release its VM memory.

The UI shows installation stages and runtime download progress. Installation checks platform, RAM and available disk space, has a deadline, supports cancellation and exposes recoverable errors. Shutdown cancels the bound chat’s runs, revokes display tickets, disconnects browser/screen sessions and verifies that the VM stopped before reporting memory released. Proxy connections fail closed when the core disconnects; the VM disk and desktop remain available. Restarting the core reconnects the protected proxy after checking the guest boundary. Screen tickets belong to the issuing device; revoking it invalidates pending tickets and closes its active display.

## Real agent

```sh
pnpm vm:prototype $HOME/.apx/v2/labs/apx-vm-lab-demo --real
```

In **APX VM Lab**, connect ChatGPT through **Settings → Engines and models**, then select one of that plan's models in the chat composer. This is the normal APX sign-in, separate from CLI sessions and the primary office. Its credential is stored only in the scratch core home. The default agent uses the plan's native provider; CLI harnesses cannot run in this VM prototype. Other model APIs may be configured through the same settings screen.

Real mode keeps its database in `core-real`; scripted mode uses `core`. Restarting preserves the real mode's login and chat. To choose another native model at launch, append `--model=<provider/model>`; an explicit chat selection takes precedence.

Ask Nova in chat, for example: “Open the Acme dashboard, inspect the data and write a short report in /home/apx-worker/work/informe.txt.” The agent can open, navigate, inspect, click and type through the existing browser tools. Chromium is visible on the VM desktop. Its private debugging pipe travels over SSH; there is no debugging TCP listener and no fallback to the host browser. The shell and browser helpers discover the running Xfce session’s private D-Bus address from its same-user process on display `:1`; they do not assume a systemd user-bus socket. Only the minimal desktop environment is forwarded. A missing session fails explicitly instead of silently starting a separate one. The visible **APX-Agent** terminal mirrors shell commands and their results; it is a transcript, while **APX-VM** is an interactive shell. A guest-only local web server serves sample files on loopback port 8080.

Browser cards from guest tools open the Computer panel. The bound chat also routes old untagged browser messages there, so reopening one cannot launch the host browser. Guest cards use compact references; a host browser card also becomes compact while that same tab is displayed beside the chat. Screenshot polling stops for that duplicate preview. Host browser profiles, login import and MCP tools are not offered to the bound chat. The guest's network can still reach host/LAN services; use fictitious data only. Model-provider usage follows the connected account's limits.

## Verify

With the **scripted** launcher running:

```sh
node prototypes/vm-desktop/verify.ts "$HOME/.apx/v2/labs/apx-vm-lab-demo"
node prototypes/vm-desktop/verify-lifecycle.ts "$HOME/.apx/v2/labs/apx-vm-lab-demo"
node --test apps/core/src/environments/*.test.ts apps/core/src/rpc/environments.test.ts apps/core/src/server.test.ts apps/core/src/tools/shell.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s prototypes/vm-desktop -p 'test_*.py'
```

The lifecycle check switches light/dark appearance, checks live terminal colors and custom wallpaper preservation, stops/restarts Linux and checks persistent files; it leaves the VM stopped. Run it with the Computer viewer closed so its appearance sync does not compete with test choices. The browser check exercises the live screen, a Linux command, the real native agent loop with a scripted model, guest GUI services and keyboard input over VNC. It saves a screenshot in the runtime directory.

## Prototype boundaries

- One bound owner chat and one pre-provisioned VM. No arbitrary agent assignment or VM pool.
- No host mounts or SSH agent forwarding. VM networking can still reach host/LAN services; complete egress enforcement is pending.
- No file/Git synchronization, host browser access, external harness execution, late MCP loading or background shell jobs for the VM chat. Its host terminal is refused.
- Guest commands kill their process group on completion and time out after 45 seconds. Taking control cancels the process group immediately; cancellation records fence SSH commands that arrive late. A lost core connection may still leave a command running until that guest deadline.
- Screen tickets expire before connection and are single-use. An accepted screen connection lasts at most 30 minutes. RFB keyboard, pointer, clipboard and resize input is filtered by the current control lease in the server as well as disabled in the viewer. Fine-grained device revocation is pending.
- Regular APX startup performs no VM downloads or boots. Owner activation installs only missing dependencies. Lima and noVNC are justified here by the real VM and RFB requirements; noVNC loads only with the Computer panel.

Before a general release, independent review and complete host/LAN egress isolation remain UNVERIFIED.

## Security verification

On a separate protected lab with no active agent turn, run `node prototypes/vm-desktop/verify-security.ts /tmp/apx-vm-lab-example`. It checks the worker/firewall boundary, probes private destinations against a harmless host canary and verifies public HTTPS. It does not upgrade or mutate the original lab. `verify-lifecycle.ts` additionally exercises shutdown, persistent files and appearance, leaving that lab stopped. See [VERIFICATION.md](VERIFICATION.md) for the full validation scope.
