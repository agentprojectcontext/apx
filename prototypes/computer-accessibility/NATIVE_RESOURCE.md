# Private Desktop observer resource

The original build experiment now lives in `apps/desktop/scripts/build-computer-observer.ts`; its Swift sources and
native behavioral tests live in `apps/desktop/native/computer-observer/`. The Desktop build carries the private helper
on macOS, but no runtime caller or agent capability is enabled yet. See [the owned reader contract](OWNED_OBSERVER.md)
and [the native experiment](../../apps/desktop/native/computer-observer/README.md).

## Build contract

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
On a non-macOS target the builder returns `unsupported`, removes a previous destination and invokes no macOS toolchain.

`prepareDesktopObserver()` selects the build target through the shared `targetOf()` contract. macOS targets require
a macOS build host and a successful `built` result. The Desktop build invokes it before esbuild; exceptions abort the
build. `scripts/package.ts` passes the explicit target to this build and waits for its success before invoking
electron-builder. A failure must not be recovered by invoking electron-builder directly on old build output.
The development output is fixed at `apps/desktop/dist/native/computer-observer`. The macOS-only `extraResources`
entry copies it to `Resources/computer/observer`, outside ASAR and outside the standalone daemon's staging tree.
Linux and Windows targets do not copy it. Build-time `APX_TARGET` is not a runtime executable override.

The executable is not resolved through PATH, and no compiler is run at observation time. Build-time toolchain
selection still follows the installed Apple development tools; reproducible release toolchain provenance is not
established here. Ad hoc signature verification checks code consistency, **not publisher identity or protection from
same-user replacement**. There is no adjacent hash presented as authentication. Final nested signing, TCC behavior,
runtime resource loading and request authorization remain separate work.

## Reproduce

Run from the worktree on macOS with Xcode command-line tools:

```sh
node --test 'apps/desktop/scripts/*.test.ts'
pnpm --filter @apx/desktop build
lipo -archs apps/desktop/dist/native/computer-observer
codesign --verify --strict apps/desktop/dist/native/computer-observer
```

For a different macOS architecture use `APX_TARGET=mac-x64` or `APX_TARGET=mac-arm64` at build time. Do not run
concurrent builds against the same output directory. A cross-build does not establish native Intel behavior.

## Evidence and limits

Twenty-two builder tests use disposable filesystem output and an injected tool runner. Five consumer tests cover
architecture selection, the fixed private output directory, aborting with residual output, unsupported results,
invalid targets, non-macOS hosts and removal of leftover macOS resources for other targets. These tests do not run
Swift, lipo, codesign or a package.

Before relocation, the real Apple Swift 6.4/Xcode 27 toolchain compiled both slices on an arm64 macOS host, lipo
confirmed the universal inventory, and codesign verified the ad hoc signature. The universal binary ran through
`ObserverReader`, with `/usr/bin/arch` explicitly selecting each slice. Both completed the private hello and returned
validated `IDENTITY_MISMATCH` refusals for a nonexistent PID before any AX read, followed by stop. This was an arm64
host, **not a physical Intel Mac**. After relocation, the actual Desktop build compiled and verified arm64 and x64
helpers separately; the x64 helper also completed the validated refusal and stop on the arm64 host. The relocated
Swift behavior suite passed 50 tests, and the arm64 build passed 17 Node and 19 Python real-descriptor tests.

A separate electron-builder 26.15.3 arm64 directory build used the real Desktop configuration with only the daemon's
staged resources omitted and the app name, identifier and output isolated. The helper appeared at the configured
`Resources/computer/observer` path. `codesign --verify --deep --strict` passed on that app; the packaged helper
completed hello, a validated `IDENTITY_MISMATCH` refusal without AX, and stop through `ObserverReader`.
Electron-builder replaced the helper's build-time signing identifier with an automatically generated identifier;
the final signature remained ad hoc, with no team identity. Do not use the pre-build identifier as publisher proof.
That first check was a resource-only directory package, not a full installer or a running packaged Desktop.

The subsequent official `pnpm package:mac` flow completed without mocks: panel build, Desktop build, daemon staging,
isolated staged-core `/health` smoke, electron-builder ZIP and DMG, daemon bundle and checksums. Inspection of the
extracted ZIP confirmed the external arm64 helper, no duplicate inside ASAR, and coexistence with both global
resource sets (daemon sources and dependencies). The standalone daemon archive contained no native observer.
The extracted app passed deep strict signature verification; its helper completed the validated refusal and stop;
all three artifact checksum sidecars matched. No artifact was installed, published or opened as a Desktop app.

A separate failure-path check launched the actual official package entry and its actual Desktop build subprocess,
while omitting only the web build and injecting a filesystem refusal when removing the existing native helper.
The process failed with `OBSERVER_BUILD_FAILED`, retained the helper byte-for-byte, and never reached staging or
electron-builder. This is process-level build-abort evidence, separate from the injected consumer unit test.

This evidence does not establish native AX access, TCC inheritance, a shipped release, general platform support,
end-to-end improvement, or permission to read any real application.

Docs impact: updated — build prerequisites and target handling are documented in the source-install guides in both
languages, the Desktop guides, `rules/RELEASE.md` and these laboratory notes. Runtime permission behavior is unchanged.
