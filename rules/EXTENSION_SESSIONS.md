# Managed extension sign-in sessions

Marketplace distinguishes turning an extension off, disconnecting its saved sign-in, and removing its package.

- **Turn off** stops its MCP processes and retains its sign-in cache.
- **Disconnect** stops all of that extension's MCP processes, including pending tests and sign-in callbacks, then clears its managed bridge caches. It keeps the package, settings and enabled flag. It does not revoke authorization at the provider.
- **Remove** uninstalls the extension and clears its persistent data under the existing uninstall contract.

## Contract and scope

`ExtensionInfo.session?.can_disconnect` advertises local session management, not an authenticated account. It is present only for recognized `mcp-remote` launchers (`mcp/bridge.ts`). API-key settings, arbitrary stdio programs and HTTP MCP definitions do not acquire a sign-out action.

`extensions.disconnect({ id })` is a human-only, idempotency-keyed protocol operation returning `ExtensionInfo`. It uses the existing extension mutation serialization, emits `extensions.changed`, and refuses unknown or unsupported extensions. A busy mutation or a process that cannot stop fails rather than erasing a cache while that process could write it again.

The core chooses the cache location: `extension-data/<extension>/mcp-remote/<server>`. A manifest cannot substitute a shared cache location. Disconnect clears the extension's bridge subtree, not other connectors, the package or unrelated plugin data. Symbolic-link ancestors are refused.

After the processes have exited, disconnect persists a sign-in requirement before clearing the cache. Automatic tool discovery, tests, definition changes, turning off/on and core restarts cannot resume that session. An explicit `mcp.signIn` clears the requirement and starts a new sign-in. A receipt prevents an earlier sign-in operation that was waiting on process closure from adopting a later disconnect.

Live state remains in `mcp.list`: `starting`, `ready`, `needs-sign-in`, errors and disabled state. `ExtensionInfo.session.saved` reports the presence of a managed bridge credential file, not its validity. An idle server with a saved sign-in is not shown as connected. APX does not read token contents or infer an account label or token expiry from the file. Multiple managed MCP servers in one extension are disconnected together; distinct extensions have isolated sessions even when their provider URL is identical.

## Verification fixture

`apps/core/src/extensions/sessions.test.ts` starts real isolated cores, uses the protocol, launches two bridge processes and completes local HTTP sign-in callbacks. It checks session retention on turn-off, connector/server isolation, explicit reconnection, stale callback failure, a pending callback stopped by disconnect, restart persistence, unsupported key-only extensions and linked-directory refusal.

`session-bridge.test-support.mjs` is reusable in a panel fixture: install a synthetic manifest with `command: "npx"`, arguments `["-y", "mcp-remote", "https://mcp.example.com"]`, and environment `NODE_OPTIONS: "--import=<file URL of the fixture module>"`, `FIXTURE_CALLBACK_FILE: "<temporary callback file>"`. The preload handles MCP and never enters the real launcher main or contacts a package registry/provider. The core supplies the isolated `MCP_REMOTE_CONFIG_DIR`. Read the callback file and GET its loopback URL to finish synthetic sign-in; it contains no real account. Use only a disposable core home. Close the core and all processes before deleting its temporary files.

Focused command:

```bash
node --test --test-concurrency=1 apps/core/src/extensions/sessions.test.ts apps/core/src/mcp/sign-in.test.ts apps/core/src/mcp/lifecycle.test.ts
```
