# Protected computer verification

The original prototype and its runtime are retained independently. Integration starts from the current `release/v2` and preserves the concurrent desktop installation/authentication changes.

## Boundaries exercised

- Fresh isolated Debian VM, distinct from the original lab disk. Worker UID 1001 has no sudo or administrative groups. Lima administrator home, cloud-init media and administrator runtime remain inaccessible.
- Root-owned nftables blocks direct worker IPv4/IPv6 egress except guest loopback. The user service requires the firewall. Firewall reload replaces only its own table atomically; repeated setup does not duplicate rules.
- A host proxy reached through a private SSH reverse forward permits public HTTP(S). Every DNS answer must be public, the socket uses a pinned IP, and current host interfaces/subnets are excluded. Policy changes close existing connections. Request, socket, header, idle and lookup limits constrain resource use.
- Real guest probes refused direct host/LAN/public sockets and private HTTP/CONNECT destinations. A harmless host HTTP canary received zero requests; public HTTPS succeeded.
- Real `environments.command` ran as UID 1001 in `/home/apx-worker/work`. Guest work survives shutdown/restart; closing the core disconnects networking without deleting or stopping the guest disk.
- Protocol regressions cover owner-only activation, incompatible task-chat binding, stopped-chat deletion/rebinding, guest-only tools, no host fallback, control transfer, local process teardown, and device revocation of pending/live displays and established RPC sockets.
- Mounted browser regressions cover guest browser references, control/appearance/stop/restart, an old status response arriving after shutdown, and office startup when optional VM status fails.

## Reproduce

```sh
node --test apps/core/src/environments/*.test.ts apps/core/src/rpc/environments.test.ts apps/core/src/transport/rfb-input.test.ts
python3 prototypes/vm-desktop/test_guest_session.py
pnpm preflight
pnpm test:coverage:all
pnpm perf
node prototypes/vm-desktop/verify-security.ts /tmp/apx-vm-lab-example
node prototypes/vm-desktop/verify-lifecycle.ts /tmp/apx-vm-lab-example
```

Use a separately launched lab for the last two commands. Security verification refuses an unready guest or a lab with active agent turns. Lifecycle verification writes only lab files, checks theme/persistence, and leaves its VM stopped. Neither command is intended for the owner's original working VM.

## Scope

The backend supports macOS Apple Silicon. One VM is shared by every allowed agent, each as its own Linux user on its own screen, with the core's ledger of who holds each screen (rules/DECISIONS.md#d-152). An agent uses it only with the owner's grant (rules/DECISIONS.md#d-151). The per-user screens, private VNC sockets, X cookies, widened firewall and the agents' loopback isolation (`verify-security.ts` now checks agent A's listener refuses agent B and serves A) were written after the runs recorded above and have not been exercised on a real guest yet. Host folders, SSH agents, browser profiles, external harnesses and MCP tools are not shared with the guest. File/Git synchronization and VM pools are outside this implementation.

The boundary assumes the host core, Lima administrator, guest kernel and hypervisor remain trusted. It does not defend against kernel/hypervisor exploits or turn publicly reachable third-party services into private resources. Offline public destinations and a closed core fail closed rather than falling back to host execution.
