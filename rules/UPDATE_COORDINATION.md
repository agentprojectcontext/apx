# Coordinated APX updates

## Ownership and entry points

Architecture impact: **STRUCTURAL**. The core owns the shared release intent; Desktop owns its installer and the
native recovery path. Connection screens and theme selection are unchanged. URL and SSH connections use the same
authenticated protocol: SSH is a transport option, never update authorization or a prerequisite.

- `system.update_state` reads the running version and shared coordination state.
- `system.update_prepare` validates a concrete stable release, this server's core bundle and the requesting
  Desktop's platform package, each with a checksum asset, then records the target.
- `system.update { target }` uses that prepared release, never independently selects the latest one.
- Existing unpinned `system.update {}` remains available for standalone browser/terminal maintenance. An active
  shared plan takes precedence, so an older client cannot silently replace the coordinated target.

All three methods enter the existing router. Update state/preparation are owner-only; preparation and application
require idempotency keys. A node or outside client's chat scope does not grant update permission. No new endpoint,
agent tool, shell access or SSH command is introduced.

## State and side effects

The shared intent lives in `update-coordination.json` under the injected core home, not in a version directory.
Writes use a private temporary file and rename. The existing singleton home lock prevents two production cores
from installing into one home concurrently. Inside that core, preparations serialize; applications of the same
target share one in-flight promise and a persisted `restarting` state prevents a second installation.

States are `prepared → installing → restarting → complete`, or `failed`. Package checks happen before preparation;
downloads are checksum-verified by the existing installer before switching `current`. Preparation records release
intent, not a claim that every package has already been downloaded. Core downloads share a fifteen-minute budget;
extraction has five minutes. Desktop refuses application when the server fails or cannot confirm its target.

Only a newly running core whose version equals the pinned target marks the update complete. A process restarted
on another version marks interrupted installation/restart as failed. A supervisor which never restarts reaches a
five-minute confirmation deadline when update state is read. Failed plans require preparation before retrying.
Old and currently running bundle versions remain available to the existing installer rollback procedure.

## Desktop sequencing

The native coordinator is used by the panel, application menu and background updater. It persists a pending target
scoped to connection and server home identity. Before activating a staged app it confirms the authenticated server
is running the exact target. Changing connections revokes that authorization. A failed or unavailable server never
authorizes installing the app. The AppImage swap is deferred until authorization, not performed during download.

Connected clients observe the shared state; a disconnected client can reconcile on reconnect. They may download
and stage their own platform package, but are not forced to restart. Native dialogs remain available without the
remote panel and explain blocked updates. The authenticated update lane declares `coordination_protocol: 1`
independently of the panel/WebSocket protocol. This allows a staged Desktop to finish against an exact target core
whose main protocol changed, without loading that core's panel. An unknown update-lane version or a legacy server
fails safely rather than letting the app update independently. The first deployment of this feature to an older server still needs that server's
existing update mechanism; this cannot retroactively add coordination methods to old binaries.

A core carried by the local Desktop still updates with the Desktop bundle. Standalone unsupervised, source-checkout
or disabled updaters do not advertise coordinated bundle support. No claim is made that all devices update atomically:
offline devices and owner-installed packages can finish later.

## Verification and release considerations

Behavioral regressions cover shared targets/concurrent requests, interrupted state, exact-version restart confirmation,
server failure, missing platform/checksum assets, unprepared targets, downgrade refusal, offline return, direct
connections, owner access and HTTP/WebSocket parity. Desktop tests cover native orchestration and installer activation.
Actual signed installers and a real remote supervisor must also be exercised before a release claim.

No database migration, credential export or release tag is required. The core and Desktop both need the new code;
the web build must be refreshed when integrating. Recovery starts with the core service log and persisted target.
Rollback follows the existing bundle `current`/previous-version procedure; clients must not activate a target which
the rolled-back server no longer confirms. Do not delete a pending file to pretend an update succeeded.
