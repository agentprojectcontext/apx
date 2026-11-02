# Accessibility bridge experiment

Research only. This is not shipped, not an APX tool, and not a replacement for `ComputerDriver`.
Nothing in this directory is registered with the core, broker, desktop or policy. The separate
[owned observer parent](OWNED_OBSERVER.md) experiments with direct-child lifecycle and bounded pipe reads; it is not
a product authorization or observation-result validator. The TypeScript bridge below was
verified only with an injected executor, not native commands. Separate [native observer](../../apps/desktop/native/computer-observer/README.md)
and [Electron laboratory](runtime/README.md) experiments ran against disposable synthetic app windows; those native
results do not verify this bridge or grant access to real apps. See [research and integration criteria](RESEARCH.md).

## Scope

`AccessibilityLabBridge` accepts an absolute executable, absolute isolated HOME, fixed session namespace,
expected native version, executor, and approval callback from a trusted lab harness. Configuration is copied;
no executable, environment, namespace, arbitrary argument list, or command can be supplied by a snapshot caller.
Use a distinct bridge and namespace per experiment. The harness must verify the binary digest and isolate its
native host lifecycle before using `executeFile`. A matching version string is not binary provenance verification.
The allowlisted observations are `version`, `snapshot`, and `get --property states`.

Snapshots can select app/window, request a skeleton, or expand a root from the latest bridge-owned snapshot.
Only the default window surface is used: there is no surface/menubar argument in the API or command builder.
Exact returned app names and window IDs are selector checks, not proof of PID/process-instance identity; aliases
and homonyms remain a production integration blocker. Root expansion may retain the native snapshot ID while
still retiring the previous local generation.
Returned native snapshot/ref prefixes, ref uniqueness, ref count, app/window selectors, completeness, node count,
and depth are checked. Every new snapshot attempt retires old refs, including failed attempts. Local opaque refs
are scoped to the bridge instance and returned generation; caller-supplied native refs are never accepted.
Public snapshot values omit native refs, field values, bounds, descriptions, and arbitrary response metadata.
Names remain untrusted and may contain private text; do not log or publish them. Returned objects are frozen.
Skeleton snapshots can omit descendants intentionally; their known nodes alone can be expanded. Other truncated
snapshots are refused. A root snapshot creates a new local generation, not a merge with old refs.

## Mutation blocker — intentional, not an implemented action path

`click(target)` and `type(target, text)` validate local snapshot/app/window/ref binding, known secure roles/states,
disabled/hidden states, advertised action, and trusted approval before any preflight process. They then read
`get REF --property states`, checking the echoed ref/property and secure/unavailable states. **They never spawn
`click` or `type`, even after a benign read.** They fail with `ATOMIC_NATIVE_GUARD_REQUIRED`.

The inspected native JSON 2.5 command implementation cannot provide the required fresh target validation:

- `get states` uses `optional_live_read` and silently falls back to cached snapshot states, without a live marker.
- `get role` uses cached identity; advertised actions and enabled state cannot be freshly attested by that read.
- A separate preflight and delivery leaves a time-of-check/time-of-use gap even if a live marker were added.
- The native type implementation can accept secure fields. A TypeScript preflight is not a sufficient boundary.

A future mutation path needs a native operation that resolves the same retained target, checks current security,
app/process/window and capabilities immediately before a single approved semantic delivery (or refuses).
These checks are not a transaction with the external application: the target may still change between validation
and delivery. If a timeout, stop, or crash overlaps delivery, the outcome is unknown; never replay automatically.
The existing `ATOMIC_NATIVE_GUARD_REQUIRED` error names this experiment's blocker, not an achievable AX atomicity
guarantee. This lab does not invent a guarded operation or allow a callback to pretend it exists. The approval callback is a
synthetic harness boundary, **not** APX permission handling, and cannot enable mutations in this implementation.
Credential, 2FA, and payment-field intent cannot reliably be inferred from accessibility metadata alone.

## Execution and errors

`executeFile` uses `execFile`, shell disabled, no inherited environment, HOME injected, 4-second process timeout,
SIGKILL, and 128 KiB stdout/stderr caps. Native snapshot deadline is 3 seconds. Tree caps are 512 nodes/32 levels;
native traversal is requested at depth 16. Selectors beginning with `-` and control characters are refused.
Malformed, binary, oversize, mismatched-protocol, nonzero-success, stderr-bearing success, and incomplete responses
fail closed. Envelope version must be exactly `2.5`; native version must match the trusted expected version.
Errors preserve only bounded code/disposition strings, not native messages, suggestions, traces, or recovery plans.
There are no automatic retries, queued actions, physical fallback, `--headed`, key, clipboard, close-app, or shell
commands. Concurrent operations fail with `BUSY`. Text is capped at 4096 bytes and rejects control characters;
text is never passed to the executor. This does not prove a native process has stopped after an uncertain result.

Limits before production: private host IPC authentication, cancellation/stop, process-tree cleanup, native live
validation and single-delivery guards with explicit residual race, PID identity binding, namespace lifecycle, packaging/signing/TCC, binary provenance, platform behavior,
APX policy/broker integration, and runtime comparison all remain unverified or unimplemented. HOME/session names
alone do not protect against other processes under the same user. A process deadline is not native-host lifecycle
control; callers must not infer safe replay from a timeout. Multiple sequential calls also have no whole-request
deadline beyond their individual process bounds.

## Behavioral verification

From the task worktree with Node 24.11 or later:

```sh
node --test prototypes/computer-accessibility/*.test.ts
```

The suite exercises real bridge parsing, command construction, ref binding, immutable results, state transitions,
approval denials, malformed responses, deadlines/buffer options, native error disposition, no replay, and the
explicit mutation blocker with a fake process boundary. It never reads implementation source, launches apps,
uses the owner's screen, or asserts successful native mutation. It does not cover `executeFile` against a real
binary. No new dependencies were added.

Docs impact: updated — this README documents the experimental API, safety boundary, verification, and blocker.
No user-facing docs/translation or news entry: no shipped capability or product code changed.
