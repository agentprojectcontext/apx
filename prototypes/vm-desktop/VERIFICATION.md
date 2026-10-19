# Prototype verification

Verified on macOS ARM64 with Node 24 (initial prototype) and Node 26 (real-agent follow-up), Lima 2.2.1 and the pinned Debian 13 ARM64 image. Source: base revision `49b13f2e383b` plus this worktree's uncommitted prototype changes.

## Checks completed

- Core unit/feature suite: 1,067 passed in the final full run. An earlier run had one intermittent Telegram confirmation failure; its focused rerun passed, followed by the complete passing run.
- Protocol suite: 32 passed. Web suite: 110 passed. Desktop unit suite: 51 passed.
- Workspace, E2E sources and prototype sources typecheck. Web production and Electron main/preload builds passed.
- Schema, public-safe text, test-quality and diff-whitespace checks passed. Biome passed with existing repository warnings.
- Browser verification against the real VM passed: live RFB screen, guest `uname`/workspace, native loop with scripted model, report creation, visible Chromium and terminal services, screen pixel updates, keyboard input over VNC and reading the resulting file back.
- Native Electron app **APX VM Lab** opened with its own profile, scratch core and dummy office. Its Computer panel displayed the VM. The native UI ran `uname -s; pwd; cat report.txt` and returned Linux, the guest workspace and fictitious report.
- The launcher starts its core and desktop under a clean environment with separate CLI configuration directories. The native UI showed external tools signed out. Real mode uses the normal provider implementation and a ChatGPT login completed by the owner in this separate app; no primary-office credentials were copied.
- A real ChatGPT-powered turn opened the guest-only Acme URL, read the accessibility tree and visible text, created `/home/apx-worker/work/informe.txt` with the guest shell, and verified its contents. The final running version produced successful browser and shell steps, a namespaced guest tab, and a `browser` message part marked `environment: "vm"`. The native card displayed “Live VM desktop” and opened the Computer panel.
- Native Electron displayed the guest Chromium and terminal side by side with chat. The panel was widened for visibility. Independent RPC verification returned Linux, the guest workspace, a 687-byte report containing the observed sample values (128 orders and 24 completed tasks), and guest-loopback VNC/sample-site listeners with no debugging TCP listener.
- After restart, the same scratch ChatGPT sign-in remained connected. The owner also exercised external browsing in this chat; Google presented a CAPTCHA, and a subsequent turn followed the project README to the v2 page. This is observational evidence, not a CAPTCHA bypass test.

## Browser-card regression

The mounted web regression covers an old untagged guest card and a new tagged card, a colliding host tab id, opening the Computer panel without any host browser action or screenshot, a different chat retaining normal host-browser behavior, suppressing the duplicate preview for the displayed host tab, and restoring it when another tab is selected. The existing transcript is classified using the core-reported VM binding; no stored messages are rewritten. The same test closes and reopens Computer using the shared panel header, verifying that its binding survives.

Native verification reloaded only the renderer, confirmed compact references for the existing untagged messages, clicked the new close button, checked through the protocol that the VM remained running and bound, then reopened it from the old v2 browser reference. The display reconnected and the close button remained visible. Web tests (110), the mounted browser regression, workspace/E2E typechecks, build and static checks passed for this follow-up.

## Desktop-session regression

The guest shell originally returned `Failed to init libxfconf: Could not connect` with exit 1. Xfce had a private session bus, while the helpers assumed the absent systemd user bus. Both helpers now discover the same-user Xfce session on display `:1` and forward only its minimal environment. The same `xfconf-query` call subsequently succeeded; creating, reading and removing a temporary probe property also succeeded through `environments.command`. Helpers were updated in the running guest without restarting the VM, core or existing browser.

Four Python regression tests cover session/display selection, minimal environment, user ownership, absent/nonlocal buses and exited-process races. Prototype typecheck, public-safe and test-quality gates passed.

Retrying the owner’s existing wallpaper request first exposed an unrelated web-decoding error in the agent’s download script. The prototype prompt now asks the agent to recover from tool errors, check intermediate commands, and download images as binary files. A subsequent native retry used the browser and guest shell to download a landscape, set the Xfce wallpaper for four workspaces, and report completion. Native visual inspection confirmed the image painted behind the browser and terminal; the model’s completion alone was not treated as proof.

## Review scope

Self-review checked command argument boundaries, single-use display tickets, stream cleanup and backpressure, owner-only display access, chat/run ownership, disabled late MCP tools, unsupported harness refusal, guest browser routing ahead of a connected host node, failed remote pipe cleanup without launching host Chrome, and persisted binding without host fallback after restart.

Independent review remains pending. Full mobile, all-platform E2E and packaged-installer verification were not run. No production release or merge is proposed.

## Known prototype limits

Guest-to-host/LAN egress enforcement, exclusive human/agent control leases, immediate remote command cancellation and fine-grained display revocation are not implemented. Commands have a guest-side deadline and process-group cleanup. A stopped or missing VM fails rather than running the requested work on the host. Use fictitious data only.
