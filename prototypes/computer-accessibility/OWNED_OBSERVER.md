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
request at a time; concurrent calls fail busy without disrupting the admitted read. Successful transport responses
are untrusted JSON objects with version 1, **not validated observation results**. Before exposing any tree, the caller
must validate the full operation-specific response shape, request identity, generation, retained handle, node limits,
privacy and browser policy. The TypeScript command type limits intended operations to window listing/observation;
it is not a runtime authorization boundary. The Swift helper still validates the complete request.

Input is capped at 8192 bytes, each response at 65536 bytes plus newline. Invalid UTF-8, malformed JSON, a co-buffered
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

## Verification

From the task worktree:

```sh
node --test prototypes/computer-accessibility/owned-observer.test.ts
pnpm exec biome check prototypes/computer-accessibility/owned-observer*.ts
pnpm exec tsc --noEmit --target es2024 --module nodenext --moduleResolution nodenext \
  --strict --skipLibCheck --allowImportingTsExtensions --types node \
  prototypes/computer-accessibility/owned-observer.ts \
  prototypes/computer-accessibility/owned-observer.test.ts
pnpm check:tests
# After compiling the current Swift helper using native-observer/README.md:
OBSERVER_HELPER="$SCRATCH/ax-owned-parent-observer" OBSERVER_SCRATCH="$SCRATCH" \
  node prototypes/computer-accessibility/runtime/owned-transport-smoke.ts
```

The process tests use disposable Node children, not injected success callbacks. They exercise independent handshake,
sequential/concurrent admission, no inherited environment, stop during initialization and an admitted read, an
injected deadline, malformed/binary/oversized output, suffixes, stderr, protocol mismatch, spawn failure and oversize
input recovery. They do not start apps or inspect the screen. Deadlines use an injected clock, not elapsed-time
thresholds. Every started child is stopped and waited in cleanup.

A separate local smoke compiled the current Swift sources using the native README's explicit file list, started
that binary through this parent, completed hello, and sent `listWindows` with PID zero. It returned exactly
`INVALID_REQUEST` without a listing or observation. Stop then completed and readiness refused reuse. This exercises
the real inherited-pipe contract but intentionally performs **no native AX read**, desktop/core request, action,
cursor movement, or end-to-end improvement measurement.

The first smoke accidentally targeted an older scratch binary and returned `OBSERVER_EXITED`; recompilation from the
current source produced the passing result. Neither the older binary failure nor the corrected smoke establishes a
product regression or general runtime compatibility. Build identity must be selected explicitly, not inferred from a
scratch filename.

Docs impact: updated — this experimental contract and README link. User docs, translations and news unchanged:
no shipped capability or product behavior changed.
