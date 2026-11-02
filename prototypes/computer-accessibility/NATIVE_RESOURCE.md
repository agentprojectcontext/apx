# Native resource build experiment

This is a build-only experiment for the observation-only Swift helper. No Desktop, daemon, protocol, tool or package
configuration imports it. It does not implement product distribution, executable authentication or accessibility
permission management. See [the owned reader contract](OWNED_OBSERVER.md) and [the native spike](native-observer/README.md).

## Behavior

`buildObserverResource()` accepts an absolute, developer-controlled output directory and an explicit nonempty list
of `arm64` and/or `x64` slices. It compiles the fixed Swift source list using `/usr/bin/swiftc`, verifies each slice
with `/usr/bin/lipo`, combines slices when needed, verifies the exact final inventory, applies an ad hoc signature
and checks that signature before publishing `computer-observer`. Intermediate files live in a unique build directory
and cleanup is attempted synchronously before returning success. Each external command has a two-minute watchdog.
It must have exclusive use of its output directory; concurrent processes building into the same destination are not supported.

A valid build invocation removes a previous destination before invoking any tool. Filesystem, compilation, inventory,
signing or verification failure throws only `OBSERVER_BUILD_FAILED`; raw filesystem, compiler and signing diagnostics
are not returned. If cleanup fails after publication, the builder attempts to remove the published binary and throws.
A filesystem refusal can prevent either initial removal or rollback: an error does not guarantee an absent artifact.
**Consumers must abort on any error and use only the path returned by a successful invocation**, never discover a
helper by its existence after a failed build. Intermediate files may also remain when cleanup is denied.
Invalid configuration is refused before filesystem changes or tool execution and preserves any previous helper.
On a non-macOS host it returns `unsupported`, removes a previous destination and invokes no macOS toolchain.
This is **not cross-packaging support**: packaging a macOS Desktop elsewhere must fail or use separately verified
artifacts, rather than interpreting this result as a successfully built helper.

The executable is not resolved through PATH, and no compiler is run at observation time. Build-time toolchain
selection still follows the installed Apple development tools; reproducible release toolchain provenance is not
established here. Ad hoc signature verification checks code consistency, **not publisher identity or protection from
same-user replacement**. There is no adjacent hash presented as authentication. Development and packaged runtime
paths, nested signing by electron-builder, TCC behavior and resource loading remain unimplemented.

## Reproduce

Run from this task's worktree on macOS, with `SCRATCH` set to the task's existing isolated temporary directory:

```sh
node --test prototypes/computer-accessibility/native-resource.test.ts
node --input-type=module -e '
  import { buildObserverResource } from "./prototypes/computer-accessibility/native-resource.ts";
  const result = buildObserverResource({
    output: `${process.env.SCRATCH}/observer-resource`,
    architectures: ["arm64", "x64"],
    platform: process.platform,
  });
  console.log(result.kind);
'
```

The output directory is a build-only laboratory input, not an agent-facing executable override. Keep binaries outside
the repository and do not substitute user applications for the synthetic fixtures.

## Evidence and limits

Twenty-two behavioral tests use disposable filesystem output and an injected tool runner. They cover thin and
universal publication, non-macOS refusal, per-stage tool failures, unexpected architecture inventories, invalid input,
filesystem refusals, cleanup failure after publication and both successful and denied rollback. These tests do not run
Swift, lipo, codesign or a package.

Separately, the real Apple Swift 6.4/Xcode 27 toolchain compiled both slices on an arm64 macOS host, lipo confirmed the
universal inventory, and codesign verified the ad hoc signature. The final universal binary then ran twice through
`ObserverReader`, with `/usr/bin/arch` explicitly selecting `arm64` and `x86_64`. Both completed the private hello and
returned the exact validated `IDENTITY_MISMATCH` refusal for a nonexistent PID before any AX read, followed by stop.
The x86_64 execution was on the arm64 host, **not a physical Intel Mac**. This is startup/transport evidence only;
it does not establish native AX access, TCC inheritance, a shipped package, general platform support, end-to-end
improvement, or permission to read any real application.

Docs impact: updated — this experiment documents its build contract and deliberately separates it from product
installation, permissions and runtime behavior, which remain unchanged.
