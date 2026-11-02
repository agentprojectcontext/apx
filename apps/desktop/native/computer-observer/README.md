# Native window observer spike

The observation mode is experimental and unconnected to agent tools. Original Swift code and platform frameworks
only; no upstream source copied or new dependency. The macOS Desktop carries this private executable outside ASAR.
Its unreleased `--pointer` mode now serves a persistent curved overlay and one AXPress, without moving the mouse, over
inherited private pipes. It is not an agent-accessible CLI, listener or permission boundary; Desktop's existing
capability, authorization and cancellation paths govern every request. The laboratory observation bridge is unchanged.

Pointer sources are `PointerOverlay.swift`, `PointerAction.swift` and `PointerRuntime.swift`. `PointerTests.swift`
exercises movement, cancellation, destination classification and easing without touching the screen; Desktop's
`native-pointer.test.ts` compiles and runs it on macOS. Production builds exclude overlays from capture.
`POINTER_RECORDING` is a lab-only compile flag that makes the synthetic indicator recordable; it changes no action
validation or movement. Packaging never sets it. See the task's pointer preview report for real runtime evidence.
Field roles with missing, empty or whitespace-only subroles refuse before action selection. An uncertain AXPress is
never retried or converted to physical input. Physical mouse fallback is also disabled in the macOS coordinate driver;
controls without a supported accessibility action require the owner to click.

## Plan and files

1. Validate a typed target and invalidate the prior attempt: `Contract.swift`, `TargetValidation.swift`.
2. Resolve live process start identity and exact CG/AX window correspondence: `NativeObserver.swift`.
3. Traverse just that window with privacy filtering and work limits: `Traversal.swift`.
4. Serve bounded, sequential JSONL on inherited pipes: `Protocol.swift`, `Main.swift`.
5. Retain explicitly selected AX windows separately: `WindowSelection.swift`, `NativeSelection.swift`.
6. Exercise public behavior with synthetic fixtures: `Fixtures.swift`, `TargetTests.swift`, `SelectionTests.swift`, `Tests.swift`.

Observation architecture impact: local build resource, without observation runtime integration. The pointer mode
above is integrated with the Desktop capability and existing core authorization; it does not expose observation tools. The trusted future parent must enforce owner authorization, browser policy, capability, request scope,
process lifecycle and stop; spawning this executable must never become an agent-accessible bypass.

## Build and tests

Run from the worktree on macOS with Xcode command-line tools. Set `SCRATCH` to an existing thread scratch folder
outside the worktree; keep binaries and all runtime evidence there. Do not use a wildcard that combines the two
`@main` entry points.

```sh
NATIVE=apps/desktop/native/computer-observer
swiftc -warnings-as-errors -parse-as-library \
  "$NATIVE/Contract.swift" "$NATIVE/TargetValidation.swift" "$NATIVE/Traversal.swift" \
  "$NATIVE/WindowSelection.swift" "$NATIVE/NativeObserver.swift" "$NATIVE/NativeSelection.swift" \
  "$NATIVE/Protocol.swift" "$NATIVE/Transport.swift" \
  "$NATIVE/PointerOverlay.swift" "$NATIVE/PointerAction.swift" "$NATIVE/PointerRuntime.swift" \
  "$NATIVE/Main.swift" -o "$SCRATCH/ax-session-observer"
swiftc -warnings-as-errors -parse-as-library \
  "$NATIVE/Contract.swift" "$NATIVE/TargetValidation.swift" "$NATIVE/Traversal.swift" \
  "$NATIVE/WindowSelection.swift" "$NATIVE/Protocol.swift" "$NATIVE/Fixtures.swift" \
  "$NATIVE/TargetTests.swift" "$NATIVE/SelectionTests.swift" "$NATIVE/Tests.swift" \
  -o "$SCRATCH/ax-session-tests"
"$SCRATCH/ax-session-tests"
```

Verified on Swift 6.4, arm64 macOS: helper compiles with warnings as errors; **50 behavioral tests pass** including
six descriptor cases documented in [DESCRIPTORS.md](DESCRIPTORS.md). The behavior suite and real transport checks
are separate evidence, not native accessibility proof.
Tests exercise real validation, traversal, filtering-before-read, serialization, injected deadlines, ref retirement,
exact window selection, identity comparison, bounded framing and sanitized failures with an injected node source.
They do not read implementation source and do not exercise ApplicationServices or another application's AX tree.
A separate spawned-process smoke uses invalid requests only, so no native observation is triggered.
Initial disposable AppKit runtime failed closed: a bare executable was rejected with `IDENTITY_MISMATCH`
(no bundle identity); the bundled fixture returned `UNAVAILABLE`. A separate scalar-only diagnostic confirmed
AX permission, successful window enumeration, and `AXWindowNumber` returning AX error `-25205`
(attribute unsupported). The existing APX screen snapshot read the same fixture's controls successfully.
Thus the legacy CG/AX exact-window mapping is not compatible with the initial native fixture. The separate AX-only
retained selection route subsequently succeeded on a disposable bundled AppKit app with two identically titled
windows: listing 27 ms, individual observations 10/4 ms (single samples, engine only). Each returned its distinct
synthetic button label, omitted the secure-field sentinel, survived reordering, and refused a replaced/closed window
and a retired generation with `WINDOW_UNRESOLVED` and no partial tree. Both child processes were terminated and
waited. A separate running baseline `screen_snapshot` also showed the synthetic button and masked secure field.
These are not paired end-to-end latency/token measurements or proof of product improvement. The normal observer
was subsequently tested on the synthetic Electron fixture and failed ELECTRON_CONTENT_NOT_OBSERVED, even with
renderer accessibility enabled. A separate fixture-only laboratory reaches synthetic renderer controls; see
[the runtime contract and limits](../../../../prototypes/computer-accessibility/runtime/README.md). General Electron support, TCC denial and cursor/focus behavior
remain **UNVERIFIED**. Do not treat fixture tests as proof of general native behavior or measured improvement.

The initial FIFO-only transport rejected Node's inherited socketpair. The observational spike now accepts the
strict Darwin unnamed connected-stream representation measured here. Seventeen real Node `execFile` tests cover correlated request IDs, malformed-envelope refusal,
handshake, fragmented/multiple/oversize frames, early/partial EOF, buffered-command rejection before acknowledgement,
closed socket output, post-handshake EOF, parent watchdog termination and kill/wait. Nineteen Python real-descriptor
tests cover anonymous pipes, wrong direction, file, TTY, closed FD, datagram, closed peer, TCP listener/connected pair,
Unix named listener/connected pair, buffered commands on FIFO/socket (including a command beyond the first read),
hello+command+close, partial-hello hangup, closed outputs, and empty/partial-hello deadlines. These tests send no AX
requests. Run them with:

```sh
OBSERVER_HELPER="$SCRATCH/ax-session-observer" node --test "$NATIVE/transport-smoke.mjs"
OBSERVER_HELPER="$SCRATCH/ax-session-observer" OBSERVER_SCRATCH="$SCRATCH" \
  python3 "$NATIVE/transport-negative-tests.py"
```

Python is a test driver only, not a runtime dependency. The deadline cases are real-process `poll` smoke tests:
they assert a helper-owned nonzero exit with no output, not elapsed-time tolerances. The independent parent watchdog
kills and waits on a hung child; watchdog termination cannot satisfy those deadline assertions. They do not replace
injected-clock boundary tests. Darwin representation portability, injected address-query faults/truncation, EINTR,
short writes and output-backpressure stalls remain unverified. This is not transport approval for production integration.

Regression proof: the prior helper acknowledged a single buffered hello+invalid-command write and emitted an
`INVALID_REQUEST` response while input remained open. The new Node test failed on that binary (watchdog killed the
still-waiting helper); prequeued FIFO/socket cases also failed. The new binary rejects without acknowledgement or
command response. Prequeued hello+command+close cases already rejected on this macOS via hangup detection; these
checks cover a deterministic closed-input case, not proof that every concurrent-close interleaving is excluded.

## Transport and typed contract

A trusted parent starts the helper with its own inherited stdin/stdout channels, no shell, and consumes stderr without
logging target content. `Transport.swift` validates both directions independently. It accepts FIFO, or a Darwin
`AF_UNIX`/`SOCK_STREAM` connected socket with local AND peer address queries successful, returned length and
`sun_len` exactly 16, family `AF_UNIX`, and all 14 returned path bytes zero. Other address representations fail closed.
`SO_ACCEPTCONN` must return zero/non-listener, except the measured Darwin `ENOPROTOOPT`; any other error rejects.
The successful peer query also rejects the tested real listener and closed-peer cases. Files, TTYs, TCP, datagrams,
named sockets, wrong direction and closed descriptors exit nonzero without observation or diagnostics.

The first frame must be exactly `{"op":"hello"}`. Only `{"version":1,"ready":true}` is returned; no AX API is called.
The parent must send a standalone newline-terminated hello, keep stdin open, and wait for the complete ready response
before sending commands. Any suffix after the first newline in the handshake buffer (even a partial command) rejects
without acknowledgement. The helper revalidates both descriptors and checks input readiness immediately before
acknowledgement; already-queued input, EOF/hangup or a poll error rejects. This deliberately conservative check also
rejects otherwise valid pipelined traffic. Before readiness, EOF, transport errors, oversize/malformed frames or the
five-second input deadline exit nonzero. Subsequent frames use the operations below.

The owned Node parent uses correlated envelopes after this handshake: `{requestID, command}` where the ID is a
36-byte UUID string and `command` is one of the same observational objects below. The helper passes that command to
the same controller and wraps its result in `{requestID, result}`. Envelope keys are exact; IDs are echoed unchanged,
not interpreted as authority. Invalid envelopes retire state through the controller's invalid-input path and produce
an uncorrelated refusal. The existing direct transport laboratory still sends unwrapped observational objects;
the owned parent never accepts uncorrelated responses or falls back to them. This is correlation, not IPC
authentication. The whole input/output envelopes share the 8192/65536-byte caps. If wrapping would overflow output,
state is retired and an uncorrelated refusal is emitted, causing the owned parent to terminate the session.

The quiet-input check and acknowledgement are **not atomic** with peer writes or close. A concurrent close/input
arrival can occur after the check; a ready response does not prove that the parent is still alive, exclusive or
trusted. No handshake authenticates the caller. After readiness, buffered commands can finish before EOF is detected;
this observation-only protocol is not cancellation or a basis for authorizing effects.
The trusted parent must still impose whole-child deadlines/output caps and kill/wait, including during the handshake:
output writes remain blocking. After readiness, EOF terminates after finishing any active request.

Descriptor inspection authenticates neither parent nor exclusivity. FIFO cannot be distinguished from a connected
named FIFO here. Channel creation, restricted descriptor inheritance, process ownership and executable provenance
remain the parent's responsibility. No socket or named endpoint is created by the helper. Another process running
as the same user is not isolated by this design.

One JSON object per newline; one response per complete input line, in order. No concurrent operations. There is no
discovery, app listing, launch, activation, screenshot, action, node-ref lookup, key, clipboard, text, AXPress or
AXSetValue operation. `observe`, `listWindows` and `observeSelected` are the only accepted operations.
All references are observational identifiers, never action capabilities. Window listing requires an exact process
identity supplied by a trusted parent; it does not discover processes.

```ts
type LaunchIdentity = { seconds: number; microseconds: number };
type Request = {
  op: "observe";
  pid: number;                   // positive Int32
  launchIdentity: LaunchIdentity; // proc_bsdinfo pbi_start_tvsec / pbi_start_tvusec
  windowID: number;              // positive UInt32 CGWindowID
};
type Node = {
  ref: string;
  role: string;                 // fixed allowlist, otherwise AXUnknown
  title?: string;               // selected noneditable control titles only
  redacted: boolean;
  children: Node[];
};
type Response = {
  version: 1;
  generation: string;
  observation?: {
    session: string;
    generation: string;
    pid: number;
    launchIdentity: LaunchIdentity;
    windowID: number;
    nodes: Node[];              // exactly the selected window root on success
  };
  error?: "INVALID_REQUEST" | "IDENTITY_MISMATCH" | "BROWSER_DENIED" | "UNAVAILABLE"
        | "WINDOW_UNRESOLVED" | "LIMIT_EXCEEDED" | "DEADLINE_EXCEEDED" | "UNSUPPORTED";
};
```

Success has `observation`, not `error`; failure has `error`, no partial tree. Optional properties are omitted, not
null. Unknown keys, unsupported operations, malformed JSON, out-of-range/fractional IDs and excess input are refused.
Identity timestamps are unsigned integers; microseconds must be below one million and seconds positive. The caller
must obtain the exact launch tuple from a trusted native process resolver: PID, app name, a rounded date, or elapsed
time alone is not equivalent. No resolver is exposed by this helper. The separate fixture harness uses ProcessIdentity.swift
to measure only its own launched child's PID/start tuple; it does not implement general app discovery.

Every processed input attempt creates a new UUID observation generation and retires earlier node refs, even if
parsing, native reads or encoding fail. Retained window handles have the separate listing lifetime described below. Oversize/unterminated EOF frames fail closed. Refs include a per-helper random session and generation;
there is no action or API accepting node refs. Legacy `observe` retains no AX elements beyond its request.
The separate selection route retains AX window elements only, not descendant controls. A future action implementation
would need a different reviewed design; retained observation handles do not authorize effects.

## Explicit AX-only selection contract

This is a separate alternative, not a fallback that changes `observe`. It never calls CG or reads
`AXWindowNumber`, geometry, focused state or display names. The exact PID and launch tuple are mandatory for both
operations. The trusted client must explicitly send one returned handle; listing never selects or traverses a window.
Listing validates process identity before/after, reads at most 64 `AXWindows` references, checks ownership and
role/subrole, and rejects duplicate equal elements. It reads an optional bounded root AXTitle, but no descendant
content or values. Root titles are private/untrusted data, not selectors. Absent or duplicate sanitized titles are
marked ambiguous; there is no automatic choice. After title reads it enumerates the bounded window set again and
rejects changed membership or duplicates before publishing handles; reordering alone is accepted. This is not an atomic
snapshot. See [DESCRIPTORS.md](DESCRIPTORS.md) for filtering and privacy limits.
An empty list is a valid success with no selectable handle.

```ts
type SelectionRequest =
  | { op: "listWindows"; pid: number; launchIdentity: LaunchIdentity }
  | { op: "observeSelected"; pid: number; launchIdentity: LaunchIdentity; handle: string };
type ListingResponse = {
  version: 1;
  generation: string;
  listing: { session: string; generation: string; pid: number;
             launchIdentity: LaunchIdentity;
             windows: { handle: string; title?: string; ambiguous: boolean }[] };
};
type SelectedResponse = {
  version: 1;
  generation: string;
  selectedObservation: {
    session: string; generation: string; pid: number; launchIdentity: LaunchIdentity;
    handle: string;
    association: "ax-only-no-capture-or-coordinates";
    nodes: Node[];
  };
};
// Failure: { version: 1, generation: string, error: fixedErrorCode }, no listing/tree.
```

Handles are opaque session + listing-generation + random UUID strings, not array indexes. The helper retains the
actual AX window objects in memory. Selection requires an exact stored handle and matching process tuple. Before
and after traversal it checks the live process identity and enumerates the current bounded AXWindows list once
at each boundary, requiring exactly one `CFEqual` match to the retained object. Reordering and homonymous titles
cannot redirect selection. Missing, replaced, duplicate, foreign-session, helper-restart, wrong-process and retired
handles fail closed, with no partial tree. The existing per-element ownership/AXWindow containment and all privacy
filters apply to traversal unchanged. No raw native errors are emitted.

Every new listing attempt invalidates all earlier handles, including malformed/failed/oversized input. Other invalid
requests, selected-observation failures and legacy `observe` also invalidate selection. Successful selected observation
keeps the current listing handles but creates fresh node refs; the selected response generation is the observation
generation, not a new listing. A helper restart loses all retained elements. There is no persistent handle store or
cross-process reuse. Bounds/deadlines and output encoding are checked before publishing a new listing.

Descriptors provide only optional bounded titles and ambiguity flags beside opaque handles. For indistinguishable
entries this prototype still has **no usable human semantic chooser**; the trusted caller must not infer identity from
list order, names, geometry, screenshots or focus, or automatically pick the first entry. An explicit test/client handle proves which
retained object was requested, not which physical window a person intended. Product selection/authorization UX
requires a separate reviewed contract; this spike does not resolve it.

Selected results have a distinct `selectedObservation` field, no CG window ID, capture ID, geometry or coordinates.
Unknown fields (including attempted capture-association claims) and unsupported operations are rejected. Never merge
this tree with a screenshot, derive coordinate actions, or treat handles/node refs as action capabilities. No capture
association is established by this route. Retention and revalidation are not an atomic transaction: remote apps may
change after the final check, and CFEqual stability/AX object reuse are platform limitations requiring runtime proof.

The 15 retained-selection behavioral tests cover listing without descendant content reads, order changes, homonyms, disappearance and
replacement before/during traversal, duplicates, process replacement before/after, foreign/restarted/generation handles,
failed/malformed listing invalidation, wrong target, browser denial, bounds, injected deadline, privacy-before-read,
capture-claim rejection, unsupported operations and legacy separation. These use injected Int-element fixtures; they
exercise the controller/traversal, **not native CFEqual semantics, TCC or live retained AX windows**. Six subsequent
descriptor cases are documented separately. Native retained selection has the limited disposable AppKit proof above;
Electron renderer coverage requires the separate lab-only exception, not this helper. The real inherited-pipe/socket
transport checks above address Node compatibility separately; they do not verify native observation or product policy.

## Native binding and failure behavior

The following CG/AX mapping requirements apply only to legacy `observe`; AX-only selection uses the separate
retained-window validation above. Privacy filters and common work limits apply to both routes.

- `proc_pidinfo(PROC_PIDTBSDINFO)` checks the requested PID and exact start seconds/microseconds, before and after
  traversal. Missing identity, terminated app, or missing bundle ID rejects. This does not prove executable provenance,
  prevent same-PID `exec`, or provide an atomic process lifetime transaction.
- CG metadata for the exact requested ID must contain exactly one layer-zero window owned by that PID. No window
  title, app display name, geometry or list index is used as a selector. CG metadata can be transiently allocated by
  the system with additional fields, but none are emitted or logged.
- Only the app's bounded `AXWindows` list is enumerated for matching; no app subtree/global menu is traversed. Every
  listed window must report role `AXWindow` and an integral positive `AXWindowNumber`. Exactly one must match the
  requested CG ID. **AXWindowNumber is not a guaranteed public AX attribute**: absent, unsupported, unknown or duplicate
  mapping rejects. There is deliberately no title, geometry, focused-window, first-window or index fallback. This may
  make observation unavailable on many apps; actual compatibility must be established with disposable native fixtures.
- Every traversed element must belong to the requested PID and, except the selected root, return `AXWindow` equal to
  that exact retained root. Missing/changed containment rejects rather than silently traversing another window. The
  root window ID, CG owner and process start identity are checked again before returning.
- Known bundle families Safari/Technology Preview, Chrome/Chromium, Firefox/Nightly/Developer Edition, Edge, Brave,
  Opera, Arc, Zen, Vivaldi, DuckDuckGo, Orion and LibreWolf are denied; `AXWebArea`
  is pruned even in other apps. This is **not exhaustive browser detection**. Unknown/custom browsers and misreported
  bundle IDs remain a blocker for relying on the helper as a browser policy boundary. Web-based Electron content may
  be omitted entirely. The parent must independently reject browser targets; browser APX remains the only web route.

## Minimization and bounds

No AX values, descriptions, help, URLs, selected text, bounds, enabled state or action lists are read. Role/subrole are
read before deciding whether to ask for a title or descendants. Every editable text field, text area, combo box, secure
role or secure subrole omits both title and descendants. Menu/menu-bar roles and web areas are excluded before title or
child reads. Traversal never reads window/container titles. Listing separately reads optional root window titles for
descriptors as described above. Traversal titles are requested only for buttons, checkboxes, radio buttons and static
text; output is capped at 128 UTF-8 bytes with control characters removed. Unknown roles serialize as a fixed
`AXUnknown` and never have titles requested. Public labels remain untrusted and may still contain private information.

Traversal rejects cycles/repeated elements, more than 256 visited nodes, depth beyond 16, or more than 64 app windows.
Native child arrays are counted before copying, with a 256-element per-array cap; no unbounded `entire contents` read.
There is a two-second monotonic request budget checked between calls, and 100 ms AX messaging timeouts. Input lines are
capped at 8192 bytes and serialized output at 65536 bytes; no partial/truncated success is returned. Errors contain fixed
codes, never raw target data or exception messages. Invalid frames do not reach any native API.

These are best-effort budgets, **not a hard cancellation guarantee**. AX, AppKit, CG, process queries, memory allocation,
and blocked pipe output may outlive a check. Single AX attribute strings can be allocated before output capping; the
helper cannot bound memory used inside a remote app or platform framework. The caller needs an external whole-process
deadline, termination/wait and output cap. Stdin EOF is processed only when the current observation finishes. There is
no concurrent cancel frame, stop callback, signal cleanup, post-handshake idle/input timeout or output-write deadline.

External AX reads are not atomic. An element's role, secure state, containment, process or contents may change between
checks; metadata can be wrong or unsupported. Filtering minimizes known secure fields but is **not perfect privacy or
credential detection**; a label on a noneditable control can contain sensitive data. Never log/publish successful trees.
No retries, uncertain effects or physical fallback exist because there are no effects at all.

## Remaining observation work

Disposable-app runtime proof and comparative benchmarks belong to the caller, not this unit suite. Signing, packaging,
TCC attribution/inheritance, notarization, helper provenance, isolation from same-user peers, cancellation/lifecycle,
APX broker/policy authorization, supported OS range, browser-boundary completeness, and independent/security/architecture
reviews remain open. The helper checks `AXIsProcessTrusted()` without prompting; no permission request or system setting
is performed. Compilation is not evidence of TCC permission. No production ship/integration recommendation is implied.

Docs impact: updated — this README covers observation experiments and the unreleased pointer mode. Desktop guides
in English and Spanish, the computer skill, human model and news cover the native cursor and disabled macOS physical
fallback. Observation experiments remain unconnected to agent tools.
