# Owned observer parent experiment

`owned-observer.ts` is an unregistered, observation-only Node parent for the sibling Swift observer. It is not an
APX permission gate, desktop adapter, tool, authenticated service, or production helper recommendation. Only trusted
laboratory code can construct it; no agent-facing executable, arguments, environment, HOME, or raw command API was
added. No product file imports it. Architecture impact: local experiment.

## Contract and lifetime

The launcher injects an absolute executable, an absolute existing isolated HOME, and optional fixed trusted arguments.
The launcher must verify executable provenance and restrict use to its approved synthetic targets. The parent spawns
one direct child without a shell, with inherited anonymous stdin/stdout/stderr channels, and only HOME/LANG/LC_ALL in
the provided environment. On macOS Core Foundation can add `__CF_USER_TEXT_ENCODING` during child startup; that is not
an inherited secret. These controls do not defend against a compromised binary, same-user debugging, or a malicious
child spawning descendants. There is no process-group supervision, signing, hash verification or OS sandbox here.

The parent sends a standalone hello and waits for the exact version-1 ready frame before a request. It admits one
request at a time; concurrent calls fail busy without disrupting the admitted read. Each command is wrapped in
`{requestID, command}` using a fresh UUID; the helper returns `{requestID, result}`. Both envelope keys must be exact,
and the response ID must match the currently admitted request. A delayed response from an earlier request terminates
the session instead of satisfying a newer request, even if it arrives in a separate chunk after admission. IDs are
correlation, not authentication. A helper without this envelope support fails closed; there is no uncorrelated
fallback. Successful transport results are untrusted JSON objects with version 1, **not validated observation results**. Before exposing any tree, the caller
must validate the full operation-specific response shape, request identity, generation, retained handle, node limits,
privacy and browser policy. The TypeScript command type limits intended operations to window listing/observation;
it is not a runtime authorization boundary. The Swift helper still validates the complete request.

Input including the correlation envelope is capped at 8192 bytes, each response including its envelope at 65536
bytes plus newline. If adding a response envelope exceeds the helper's output cap, it retires selection state and
returns an uncorrelated refusal; the parent treats that as a terminal transport error, not an observation. Invalid UTF-8, malformed JSON, a co-buffered
suffix, unsolicited idle output, wrong protocol and any stderr content terminate the session with a fixed error;
raw child text is never returned in an error. Stderr is drained without retaining its contents. Frames can be
fragmented across chunks. Separate descriptors and separate chunks have no atomic ordering: an apparently valid
response may precede a later error or close. This is not atomic delivery, IPC authentication, or a privacy guarantee.

Initialization and each admitted read have one injected-clock deadline (default four seconds). On timeout, stop,
transport failure or malformed output, the parent kills its direct child with SIGKILL, destroys input, and rejects
pending readiness/request promises only after Node reports child and pipe closure. `stop()` is terminal and waits
for that closure; repeated stop is harmless. There is no restart, automatic retry or replay. A child exit between
operations makes subsequent calls fail. An oversized command is rejected before writing and does not retire the
session. A successful idle session must be explicitly stopped by its owner: there is no idle lifetime limit.

The OS may delay termination or closure. A hostile descendant retaining descriptors can prevent Node's close event;
this parent does not promise bounded kill/wait in that case. Its response framing does not establish provenance of
Electron renderer contents. Do not use this parent to enable mutation or bypass the product broker/policy/stop path.

## Private semantic caller

`observer-reader.ts` composes the transport with `observer-results.ts`; it is still an unregistered laboratory caller,
not a product adapter. Its trusted launcher still chooses and verifies the executable and authorizes synthetic targets.
No core, desktop, broker, permission or browser-policy boundary imports it. It does not establish native provenance,
truthful redaction, safe Electron document ancestry, or privacy of static text and window titles.

Before delivery it copies the command and checks PID/start identity shape and, for observation, membership in the
current retained selection. It admits one read at a time, refusing concurrent work without cancelling the admitted read.
The returned result must have exactly the keys for the requested operation, the same PID/start identity, a stable helper
session, a fresh UUID generation and matching inner/outer generation. Listings admit at most 64 unique handles scoped
to that session/list generation; absent or duplicate titles must be explicitly ambiguous. A new listing replaces the
selection. An observation must use the selected handle and the AX-only/no-capture association. It never supplies a
coordinate or action target.

Trees admit one non-redacted AXWindow root, at most 256 distinct generation-scoped refs and depth 16. Roles are allowlisted; editable roles
must be redacted, and redacted nodes cannot expose titles or descendants. Titles are optional, at most 128 UTF-8 bytes,
and limited to the native observer's display-label roles; the caller additionally refuses Unicode control/format
characters. Unknown fields, values, actions, mixed error/success frames and unknown failure codes are refused, not
silently stripped. Validated output owns a new tree, so changing the input object afterward cannot change it.

A fixed native error retires selection but permits explicit relisting. A malformed result, invalid command, transport
failure or explicit stop retires the entire reader and waits for transport shutdown, returning only a fixed error.
There is no replay or automatic recovery. Generation history is capped at 4096 accepted responses; reaching that cap
requires explicit creation of a new reader rather than unbounded retention. The same trusted-helper/no-descendants
shutdown limitation still applies. Checking a redaction flag is not proof that the helper avoided sensitive reads.

## Verification

From the task worktree:

```sh
node --test prototypes/computer-accessibility/{owned-observer,observer-reader,observer-results,observer-result-limits}.test.ts
pnpm exec biome check prototypes/computer-accessibility/owned-observer*.ts
pnpm exec tsc --noEmit --target es2024 --module nodenext --moduleResolution nodenext \
  --strict --skipLibCheck --allowImportingTsExtensions --types node \
  prototypes/computer-accessibility/owned-observer.ts \
  prototypes/computer-accessibility/owned-observer.test.ts
pnpm check:tests
# After compiling the helper using apps/desktop/native/computer-observer/README.md:
OBSERVER_HELPER="$SCRATCH/ax-owned-parent-observer" OBSERVER_SCRATCH="$SCRATCH" \
  node prototypes/computer-accessibility/runtime/owned-transport-smoke.ts
```

The process tests use disposable Node children, not injected success callbacks. They exercise independent handshake,
sequential/concurrent admission, no inherited environment, stop during initialization and an admitted read, an
injected deadline, malformed/binary/oversized output, suffixes, stderr, protocol mismatch, spawn failure and oversize
input recovery. They do not start apps or inspect the screen. Deadlines use an injected clock, not elapsed-time
thresholds. Every started child is stopped and waited in cleanup.

A separate local smoke compiled the current Swift sources using the native README's explicit file list, started
that binary through this parent, completed hello, and sent two correlated `listWindows` requests with PID zero.
Both returned exactly `INVALID_REQUEST` without a listing or observation and with distinct generations. Stop then
completed and readiness refused reuse. This exercises
the real inherited-pipe contract but intentionally performs **no native AX read**, desktop/core request, action,
cursor movement, or end-to-end improvement measurement.

The private semantic caller additionally passed 58 behavioral tests (47 result/limit checks and eleven real Node-child
reader cases), including PID/launch/session/handle mismatches, generation replay, caps, malformed shapes, disclosure
fields, secure-node violations, copied inputs/output, concurrent admission and terminal stop. Together with the
existing transport/bridge/tree suites, 115 tests pass. Targeted strict TypeScript, Biome, test quality and private-data
gates pass. These checks do not exercise native AX or the product.

A freshly compiled Swift helper also completed two correlated reads for the nonexistent maximum signed PID with
syntactically valid start identities through `ObserverReader`. Both returned exactly the validated fixed
`IDENTITY_MISMATCH` result; stop was terminal. This reaches the real process-identity refusal before AX traversal;
it does not establish positive native-tree compatibility or authorize an app read. Reproduce with:

```sh
OBSERVER_HELPER="$SCRATCH/ax-validated-observer" OBSERVER_SCRATCH="$SCRATCH" \
  node prototypes/computer-accessibility/runtime/validated-transport-smoke.ts
```

## Positive native fixture read

`runtime/validated-native-fixture.ts` launches only the disposable AppKit fixture identified explicitly by its trusted
launcher. The fixture's source and bundle metadata are `runtime/NativeWindowFixture.swift` and
`runtime/NativeWindowFixture.plist`. The driver resolves the launched PID/start identity, uses the same `ObserverReader`
for every read, and emits counts, flags and timing samples only, never titles, trees or helper error text. It kills and
waits for the owned fixture after stopping the reader. This is a developer-run experiment, not an agent-facing launcher.

The real native run passed with both identically titled windows marked ambiguous, distinct synthetic button labels,
secure sentinel absent from the returned trees, preserved retained selection after reordering, and exact
`WINDOW_UNRESOLVED` refusals after replacing/closing a window. The caller then refused retired selection locally.
A second run rebuilt the fixture and identity probe from the repository sources and passed the same assertions.
Listing/observation samples were 36/14/8 ms and 32/14/5 ms, respectively. They are not a paired benchmark, include
different cold/warm costs, and do not measure product end-to-end speed, tokens, focus or pointer behavior.

Reproduce on macOS after compiling the current helper with the native README. The launcher must restrict all paths
to this worktree's sources and an isolated scratch directory; do not substitute a real user application. This creates
and closes disposable windows, so coordinate one screen operator first.

```sh
LAB=prototypes/computer-accessibility/runtime
mkdir -p "$SCRATCH/AcmeWindowSession.app/Contents/MacOS"
cp "$LAB/NativeWindowFixture.plist" "$SCRATCH/AcmeWindowSession.app/Contents/Info.plist"
swiftc -warnings-as-errors "$LAB/NativeWindowFixture.swift" \
  -o "$SCRATCH/AcmeWindowSession.app/Contents/MacOS/AcmeWindowSession"
swiftc -warnings-as-errors -parse-as-library "$LAB/ProcessIdentity.swift" -o "$SCRATCH/runtime-identity-probe"
OBSERVER_HELPER="$SCRATCH/ax-session-observer" OBSERVER_SCRATCH="$SCRATCH" \
OBSERVER_NATIVE_FIXTURE="$SCRATCH/AcmeWindowSession.app/Contents/MacOS/AcmeWindowSession" \
OBSERVER_IDENTITY_PROBE="$SCRATCH/runtime-identity-probe" node "$LAB/validated-native-fixture.ts"
```

Independent review identified a non-window-root gap, now rejected with a negative regression, and requested stop after
transport admission, now covered by an injected-clock subprocess test. The latter does not establish that a native
backend received the read before stopping; it establishes that an admitted outstanding read cannot publish a result.
Review closure on these changes remains separate from running tests. No product integration is approved by this evidence.

The first smoke accidentally targeted an older scratch binary and returned `OBSERVER_EXITED`; recompilation from the
current source produced the passing result. Neither the older binary failure nor the corrected smoke establishes a
product regression or general runtime compatibility. Build identity must be selected explicitly, not inferred from a
scratch filename.

Docs impact: updated — this experimental contract and README link. User docs, translations and news unchanged:
no shipped capability or product behavior changed.
