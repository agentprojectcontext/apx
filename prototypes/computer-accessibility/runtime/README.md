# Electron observation laboratory

This experiment is not registered as an APX tool, node capability or protocol method. It does not change the browser
policy, normal observer, core or desktop. It is restricted to the disposable Electron fixture launched by the harness,
with a separate scratch userData directory. Do not point it at another app or use it as an authorization bypass.
No actions, keys, text, focus request or pointer movement are implemented.

## Why this separate probe exists

The default observer excludes AXWebArea before reading descendants. On the synthetic Electron fixture that returns
only native window chrome, even with `--force-renderer-accessibility`. The lab tests whether useful renderer controls
can be observed without generalizing that exception. `ElectronLabProbe.swift` is a one-shot diagnostic with a 5-second
parent-process watchdog, not the persistent/hardened helper transport. The probe may return a structured error with
process exit 0: that status alone is not observation success. The driver checks the response's `error` field and the
expected observations; its exit status describes its full assertions, including expected refusals.

The harness launches the known local fixture with `--force-renderer-accessibility`, probes its PID/start identity, and
injects that exact target plus the two canonical data URLs as immutable per-launch lab authority. The request must
match all of them before native access. This environment is **not authentication or a product capability**; the trusted
laboratory launcher supplies it. A separate process reading the fixture is not permission to observe arbitrary Electron
apps. The helper still checks the live process identity, browser deny families, owner PID, exact retained AXWindow,
window presence and a bounded whole-observation deadline before publishing results.

Only the separate `SyntheticRendererSource` converts AXWebArea into a traversable group, after AXURL matches one
of the exact fixture URLs. Missing, changed or foreign URLs fail closed before that subtree's titles/children. The
normal traversal is unchanged. The canonical static data documents have no scripts, preload, Node integration or
devtools, and a restrictive CSP. This constrained provenance is not transferable to a real Electron app, webview or
browser. A bundle identifier alone is insufficient. URL validation and descendant traversal are not atomic: navigation
may occur between them, and an accepted root does not establish descendant provenance. A native nested-frame test now crosses an allowed synthetic root and rejects the foreign child document.
A controlled full navigation after root acceptance was also exercised, as described below. Other navigation interleavings
remain unverified; the URL check is not a general product security boundary.

Editable/secure controls and menus retain the original filtering. Static text and button labels are deliberately
synthetic and approved for this experiment: their general privacy is not guaranteed by input redaction. The probe
never prints titles, URLs, AX trees, native error messages or sentinel contents. It reports only counts, label-presence
booleans, sentinel-absence booleans and fixed error codes. Each window observation must contain exactly one of the
two expected control labels, not the other window's label. The probe constructs the tree and its permitted titles in
memory before reducing the output. Sentinel absence tests only that observed serialized tree; it does not prove no
sensitive attributes were read or that other roles are private. Injected tests separately verify no title/child reads
for the specific filtered roles they cover. No array-order/window-title chooser is being tested.

## Checks and exact evidence

- Five injected-source behavior tests verify the default exclusion remains unchanged, allowed synthetic buttons are
  reached without reading input/menu titles or descendants, missing/remote/changed root URLs are rejected, and an
  unexpected nested renderer URL is rejected before its subtree is read. The fifth verifies the pause hook runs only
  after URL acceptance and before content, propagating its failure without content reads. They do not exercise native AX.
- The real local Electron run reached both distinct synthetic buttons in separate retained windows (18 nodes each).
  Ordinary/secure label/value and menu sentinels were absent from both observations. Changing request PID or launch
  identity away from launcher authority was rejected without observations. This is request-boundary evidence, not
  proof of authenticated helper transport.
- A fixture containing an iframe changes its top-level data URL and is rejected before renderer traversal. This does
  **not** independently prove native nested-iframe handling; nested refusal is separately tested with an injected source.
- The separate `nested-iframe` variant trusts the exact synthetic parent URLs that contain an iframe. Native audit
  records one accepted document, then one rejected document; BROWSER_DENIED returns no partial observations.
  Thus this case reaches the nested native document, unlike the earlier root-mismatch test.
- A real loopback HTTP fixture, served only for this experiment, is rejected as BROWSER_DENIED. No external site is
  contacted. Both denied variants return an empty observations array and no partial tree.
- Final lab driver exit 0: local cold process plus both observations 363 ms; iframe refusal 23 ms; HTTP refusal 27 ms.
  These are single samples and include fresh helper startup; they are not a latency benchmark.
- The default retained-observer driver on the same revised local fixture, also renderer-forced, exits **1**, preserving
  ELECTRON_CONTENT_NOT_OBSERVED. With the final descriptor/transport helper: listing 28 ms, warm observations 10/6 ms,
  2052 bytes each, no expected labels.
  Different process lifecycles mean those timings cannot establish a speed improvement. The observed improvement is
  synthetic renderer-content coverage only, not APX end-to-end task success.

## Native read audit

This is a diagnostic, not an enforcement boundary: it detects requests after the fact and cannot prevent native
reads. Even a rejected driver result can follow sensitive data being fetched into memory. A partial or errored audit
must not be treated as evidence that no reads occurred.

`NativeReadAudit.swift` counts requested traversal attributes, not their values. An optional callback on the experimental
`NativeNodeSource` observes each attribute request immediately before the native call, including window association
checks and separate children count/copy requests. It is absent by default; it does not change normal observer filtering.
The lab records metadata classifications and URL decisions against retained AX identities. It reports whether any
classified filtered node had a title or children request, including requests made before classification. The bounded
512-element registry signals overflow, which the driver rejects. Unknown attribute names become `other`, also rejected.
Only fixed attribute names, counts and booleans leave the probe. Retained elements and requested-name sets remain in
memory until this one-shot process exits. This is not an OS-wide trace: process/window-selection calls outside the
traversal source, attributes implicitly fetched by the OS, and concurrent navigation are not covered.

Five direct audit tests exercise identity equality, filtering before/after requests, document decisions, unknown-name
sanitization and overflow without native attribute calls. Final audited native driver exit 0: local two-window case
had two allowed documents, four filtered input nodes and no title/children requests for those filtered nodes; it
observed the two expected labels. Nested iframe had one allowed document, one denied, three filtered nodes and no
filtered title/children requests. Other denied variants also had no partial observations or filtered content requests.
Local cold probe was 536 ms; root-mismatch/nested/HTTP refusals 28/28/29 ms (single samples, no speedup claim).
These measurements are distinct from the earlier unaudited samples. Audit coverage does not certify general privacy.

The driver requires non-vacuous audit evidence: both local documents, four filtered local inputs, and positive
role, subrole, child, window and URL request counts. The nested case requires one accepted and one rejected document
and filtered-node evidence. The five result-validator tests reject absent/disconnected audits, missing or zero required
attribute counts, missing document classifications, filtered-node loss, unrelated navigation errors and partial output.
A repeated native run with these assertions passed all five cases; this still does not certify reads outside the hook.

## Controlled navigation interleaving

The `navigate` case starts from the same accepted static data documents. A lab-only callback pauses after a successful
root URL check but before its children traversal. The probe signals one byte on dedicated descriptor 4; the trusted
Node driver orders both disposable windows to navigate to the loopback fixture and waits for load completion. It then
acknowledges one byte on descriptor 3 so traversal continues. No scripts are injected into a page. The parent enforces
a 5-second process watchdog and a 3.5-second handshake watchdog, killing and waiting for its child on failure; the
probe's whole-work budget remains active but cannot interrupt a blocking descriptor read without the parent watchdog.
Do not enable this hook outside this laboratory driver or omit the watchdog. The normal retained helper has no hook.

Final driver exit 0 covered all five cases. The controlled navigation reported one allowed document, confirmed the
pause, then returned WINDOW_UNRESOLVED with no observations (119 ms single sample). The stale root's window
association failed before any further content attribute request. This is evidence for exactly that full-navigation
interleaving, not every timing, same-document mutation, partial navigation or atomic URL/content validation. It does
not make actions or generic Electron observation safe. Other final single samples: local 535 ms, root-mismatch/nested/
HTTP refusals 25/26/25 ms. Previous samples are retained above as separate runs, not aggregated into a benchmark.

The driver now requires that exact WINDOW_UNRESOLVED outcome; an unrelated native error or deadline cannot pass as
navigation evidence. Non-navigation probes explicitly disable the pause flag rather than inheriting it from the shell.
Four Node result-validation tests cover the expected refusal, unrelated failures, missing handshakes/partial output
and vacuous audit summaries. Run `node --test prototypes/computer-accessibility/runtime/lab-results.test.mjs`.
Audit assertions also require nonzero native request counts and the expected classified input/document counts, not
just false violation flags. The stricter driver repeated all five native cases successfully with the pause environment
flag intentionally set in its parent shell: non-navigation probes still reported no pause, while navigation paused
and returned exactly WINDOW_UNRESOLVED without observations. Single samples: local 54 ms, root-mismatch/nested/HTTP
34/27/31 ms, navigation 128 ms; no latency or safety generalization follows from these samples.

The drivers terminate and await their own Electron/probe children. Fixture data lives only under the caller's scratch
path. Real user apps, TCC-denied behavior, cursor/focus stability, localized apps, actions, stale action recovery,
stop/broker/policy integration and product exposure remain UNVERIFIED. Existing retained-observer lifecycle tests are
not evidence for any future action implementation.

## Reproduce on macOS

Use the current worktree, a scratch folder and the existing Electron development dependency; no new dependency is
required. Compile the regular retained helper as described in the native-observer notes. For the standalone lab:

```bash
NATIVE=apps/desktop/native/computer-observer
LAB=prototypes/computer-accessibility/runtime
swiftc -warnings-as-errors -parse-as-library "$LAB/ProcessIdentity.swift" -o "$SCRATCH/runtime-identity-probe"
swiftc -warnings-as-errors -parse-as-library "$NATIVE/Contract.swift" "$NATIVE/Traversal.swift" \
  "$LAB/ElectronLabSource.swift" "$LAB/ElectronLabTests.swift" -o "$SCRATCH/electron-lab-tests"
"$SCRATCH/electron-lab-tests"
swiftc -warnings-as-errors -parse-as-library "$NATIVE/Contract.swift" "$NATIVE/TargetValidation.swift" \
  "$NATIVE/Traversal.swift" "$NATIVE/WindowSelection.swift" "$NATIVE/NativeObserver.swift" \
  "$NATIVE/NativeSelection.swift" "$NATIVE/Protocol.swift" "$LAB/ElectronLabSource.swift" \
  "$LAB/NativeReadAudit.swift" "$LAB/ElectronLabProbe.swift" -o "$SCRATCH/electron-lab-probe"
OBSERVER_LAB_PROBE="$SCRATCH/electron-lab-probe" \
OBSERVER_IDENTITY_PROBE="$SCRATCH/runtime-identity-probe" \
OBSERVER_FIXTURE_DATA="$SCRATCH/electron-lab-data" \
OBSERVER_ELECTRON="$(node -p 'require("./apps/desktop/node_modules/electron")')" \
node "$LAB/electron-lab.mjs"
```

To reproduce the original observer's expected failure on the same local fixture, set OBSERVER_HELPER to the compiled
regular ax-session-observer and run retained-electron.mjs with the same Electron, identity and separate scratch-data
environment variables. OBSERVER_FORCE_RENDERER=1 adds the renderer flag; without it the original run also failed.
Do not turn ELECTRON_CONTENT_NOT_OBSERVED into a success or skip its assertion.

Independent implementation and security code reviews support continuing only with the controlled synthetic fixture,
kept separate and without actions. Neither review executed or reproduced the runtime checks. Neither approved generic
Electron support, actions or integration; non-atomic navigation, descendant provenance and title privacy remain
unresolved. The native audit now distinguishes explicitly requested traversal attributes from the tree eventually serialized;
its limits above remain important. To run its five tests, use the lab-probe compile command above, replacing
`ElectronLabProbe.swift` with `NativeReadAuditTests.swift` and choosing a separate test binary output path.

Docs impact: updated — laboratory contract, reproduction and measured limits documented here. No user-facing docs,
translations or news: no APX product feature has shipped or been enabled.
