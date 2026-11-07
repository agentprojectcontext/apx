# Accessibility research and integration criteria

## Reference and license

Inspected reference: [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop), commit
`9eb9b296192fcb70bda25e918cd6dd66abfa3d0d`, Apache-2.0. The excluded local reference checkout is not part of this change.
No upstream implementation was copied into the Swift observer. Before distributing upstream binaries or source,
review the license, required notices and the actual transitive dependency licenses of the packaged artifacts.

At that revision the workspace declares Rust 1.89 / edition 2024, package version 1.0.2 and JSON envelope version 2.5.
Its dependencies include clap, serde/serde_json, tracing, libc, and platform-specific native crates. The macOS adapter
uses accessibility-sys, Core Foundation and Core Graphics crates; adopting its CLI/FFI would introduce a Rust/native
artifact build, helper lifecycle, signing and packaging responsibility. The experiments here use existing Node,
Electron and macOS frameworks only: no package dependency was added.

The reference documents macOS accessibility, Windows UI Automation and Linux AT-SPI, with OS-specific input,
window-management, screenshot and clipboard limitations. These are upstream support statements, not APX verification.
Only arm64 macOS was exercised here. Windows, Linux, Wayland and cross-platform packaging remain UNVERIFIED.

## Current APX path and useful ideas

The current desktop implementation is `apps/desktop/src/main/computer.ts` plus `computer-mac.ts`: a look obtains
window information/accessibility lines and a screenshot; timed-out element enumeration can fall back to the picture.
Actions start from screen points. macOS can resolve an accessibility element at that point and use AXPress where
supported, otherwise the existing guarded physical path applies. This already avoids some pointer movement, but
its observation/action binding is not a retained snapshot ref. A screen-point lookup can become unreliable after
layout changes. Browser observations have a distinct policy and must not inherit a general desktop exception.

The reference contributes useful interaction patterns:

- Snapshot-scoped refs instead of coordinates as the primary semantic selector.
- Explicit window ambiguity rather than first-window guessing.
- Skeleton observations and selective root expansion to bound dense trees.
- Semantic accessibility actions without physical input as the preferred native operation.
- Structured stale/ambiguous outcomes and a fresh observation rather than blind action replay.

These patterns are not security guarantees. In particular, at the pinned revision, `crates/core/src/commands/get.rs`
uses `optional_live_read` for states, with a cached-state fallback. A separate get-then-act check cannot establish a
fresh secure target or eliminate the validation/delivery race. The TypeScript bridge therefore tests parsing,
scoped refs and refusal behavior but deliberately never delivers click/type. Its synthetic approval callback is not
APX authorization. The native observer separately validates PID/start identity, retained AXWindow membership,
metadata filtering and bounded traversal, but adds no actions.

## Evidence and limits

Detailed reproducible commands and measured results live in the native and runtime READMEs, not in product claims.
The synthetic Electron lab observes renderer buttons that the conservative default observer does not reach. This
is improved content coverage on fixed fixtures, not a proven improvement in end-to-end user task success or speed.
No benchmark percentage or generalized token saving is established. Fixed-count byte summaries are not token costs.

The lab uses exact launcher-supplied synthetic document URLs, not authenticated provenance. Nested foreign iframe
refusal and one controlled full-navigation interleaving are verified. Navigation checks are not atomic, arbitrary
Electron descendants are not proven safe, titles may be private, and serialization redaction alone does not prove
which attributes were requested. The separate bounded native audit improves the latter evidence without certifying
OS-wide privacy. All observation text remains untrusted. No screenshot identity, coordinate association or approved
action can be derived from these observation handles.

## Integration gates

Do not connect this prototype directly to an agent tool or offer its CLI as a way around the existing broker/policy.
A product implementation needs, in order:

1. A person-understandable chooser/authorization flow bound to a current process instance and retained window.
   Resolve homonymous/missing titles without guessing; review title exposure independently of input filtering.
2. A private, authenticated, cancellable desktop helper lifecycle with executable provenance, deadlines and bounded
   transport. Current transport experiments are not authenticated IPC and do not provide atomic EOF/write semantics.
3. Protocol/broker/policy integration through the existing operation path. Stop/cancel must terminate owned work;
   an interrupted action has an unknown outcome and must never be replayed automatically.
4. A reviewed native single-delivery action operation with immediate live target/capability/security checks and an
   explicit residual race. Do not infer credential, payment or 2FA intent from AX metadata alone. No automatic
   coordinate/physical fallback after uncertain semantic delivery.
5. Separate browser policy and defensible renderer provenance; fixed lab URLs are not a general Electron exception.
6. Isolated core and desktop runtime tests on the same innocent native/Electron tasks as the current control:
   dynamic controls, menus, localization, multiple windows, stale refs, missing accessibility, screenshots, pointer/
   focus, success/failure, measured latency and token usage where available. Record build identity and keep ordinary
   core state untouched. Then full gates, independent/security reviews, user docs and agent skill updates.

Until these conditions are met, this is an observation-only research checkpoint, not an integration recommendation.
No core restart, migration, release or public API change is required for this checkpoint. Removing this directory
rolls it back; no product code imports it.

Docs impact: updated — research rationale, platform/license/dependency assessment, native and runtime contracts and
verification limits. No user docs, translation or news entry: no product capability has been enabled.
