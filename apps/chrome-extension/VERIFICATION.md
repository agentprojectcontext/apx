# Chrome panel preview verification

This is an unreleased development preview. Generated files are in the ignored `dist/` directory; they are not a separate chat implementation. APX serves the actual pairing gate, conversation, searchable agent picker and model controls inside the extension's frame.

## Candidate checks

- `pnpm build:web` and `pnpm build:chrome-extension`: passed.
- `pnpm preflight:static`: passed, including workspace and extension typechecks, schema, privacy, lint and portable-test checks. Lint reported warnings but no errors.
- `pnpm test:chrome-extension:browser`: 19 passed, none skipped. A preceding run under concurrent build/test load passed 18 and timed out waiting for the deliberately held first-message response in the return-to-same-agent case. The unchanged suite subsequently passed all 19 without increasing a timeout or weakening an assertion. Preserve the first failure as evidence; the passing repeat does not establish universal timing reliability. On the combined tree the late first-message cases failed in about one of four full runs: the follow-up `threads.send` never reached the core (the core stored no message) and the client's 15 s deadline aborted it. It was the test's one-shot `page.route(..., { times: 1 })`; unrouting it mid-test stranded the next request of the cross-origin frame. The route now stays registered for the whole test and lets later creations through; ten consecutive full runs then passed 19/19 with the same assertions and timeouts.
- Full-panel shell and model-selection browser checks: 23 passed, including 15 setup prerequisites and eight target cases. This is not the complete browser suite.
- Workspace package tests passed, including 2184 core and 190 terminal cases. The initial command inherited an agent-shell variable and failed a terminal owner-only fixture; rerunning with that variable absent passed. The continued test chain then found missing independent mobile dependencies. After a lockfile installation without lifecycle scripts, its remaining steps passed: 111 mobile logic cases, 146 mounted mobile UI cases, 78 repository-script cases and 10 laboratory cases. These are component results after environment recovery, not a single uninterrupted `pnpm test` invocation or full `verify`.
- `pnpm --dir apps/docs build` and `pnpm --dir apps/docs check`: passed, including 27 script cases and the standalone checker (100 source pages, 232 built routes, no errors). The earlier sitemap assertion expected 110 routes but both the candidate and an isolated staging source snapshot built 130. Its stale count was replaced with exact canonical-route set equality using the complete documentation inventory and published comparison catalog, with a duplicate check; privacy and redirect assertions remain. No production routes were removed and the count was not simply raised.
- Performance is NOT green. Initial runs exceeded time and idle RSS budgets. An isolated staging source snapshot also exceeded idle RSS (143.8/135 MB). Investigation found that the performance harness added the selected Node installation's directory to PATH, exposing globally installed agent CLIs despite intending to exclude them. The corrected launcher retains the exact absolute Node executable but searches only operating-system directories. A portable regression failed with the former search path and passed after the correction. With that isolation change, baseline RSS was 97.1 MB and candidate RSS 121.4 MB, both under 135 MB; however turn p95 still failed (baseline 96.9/60 ms, candidate 145.9/60 ms) while another checkout ran its core suite. This does not prove a universal RSS improvement or explain every latency sample. The combined candidate's subsequent uninstrumented run still failed at 182.1/60 ms turn p95 (92.4 ms p50), while idle RSS, startup, RPC and bundle budgets passed. Its send-admission p95 was 164.0 ms and wait p95 74.6 ms; those percentiles are not additive. One later paired diagnostic used the same launcher, absolute Node binary and normal settle/turn counts against the existing staging and candidate checkouts, adding CPU and GC profiling to both. Turn p95 was 19.8 ms for staging and 22.0 ms for the candidate. The diagnostic exceeded RSS budgets and does not replace the failed uninstrumented gate. The original latency was not reproduced or causally explained; no performance product fix is claimed. No budget, settle time, turn count or model was relaxed. Entry and boot sizes remain 258.7/275 KB and 324.3/330 KB.

The combined candidate's first full verification stopped in coverage: the unsharded browser suite reached 296 of 403 passing cases before the existing 15-minute command deadline. Its package-manager timeout left a fixture listening, so desktop then refused the occupied health port. The E2E runner now uses three sequential complete Playwright shards, retaining that deadline for each and accumulating all counters. Its owned process group is awaited on timeout, failure and completion before another sandbox starts. Focused tests exercise a real descendant listener with an injected deadline, command failures, all shards, explicit CI parts and build failures. Full coverage after this runner change remains pending; native Windows process cleanup is unverified.

## Automatic gates and portability

`pnpm verify` builds the panel and runs the extension browser regression suite before full coverage. CI runs the same suite in the mandatory first panel coverage job, after its build. That job uses the shared Linux browser setup, which installs the lockfile dependencies, the matching full Chromium binary, its system libraries and the sandbox profile. A failing extension test fails that coverage job and therefore the final verification result. Preflight remains the static/unit gate; this browser journey belongs to verify.

Built documentation paths are normalized before becoming URLs. A regression supplies both POSIX and Windows recursive directory entries to the same conversion used by canonical/redirect and sitemap checks. This is portable behavioral coverage, not a claim that native Windows was exercised locally.

The performance launcher's OS-only search path excludes CLI siblings of the selected Node binary. It does **not** guarantee that operating-system directories contain no agent CLIs; unlike the extension fixture, performance does not currently assert effective discovery is empty. Its samples must not be described as universally CLI-isolated.

Combined-tree gates remain required: earlier results describe the original feature branch, not the prepared staging tree. The laboratory is excluded from the integration candidate and its original history is preserved separately.

## What the browser suite proves

Tests start real scratch cores with temporary homes, ports and tokens, and load generated MV3 bundles in disposable Chromium profiles. Their chat replies use an explicitly scripted model, not a paid or remote provider. The runner restricts PATH and the fixture refuses to start if Claude Code or Codex can be discovered.

- Normal code pairing occurs inside APX, never in an extension token field. Reload retains the paired conversation.
- Model choices persist through the actual protocol and reach the engine. Complete long names and references remain readable in the menu at narrow widths.
- New chat searches agents, roles and projects, preserves the current conversation when dismissed, and opens an agent/project-specific draft without creating a saved thread before the first message. Models remain conversation-specific.
- A delayed first-message completion does not replace a later Beta or Home selection. Returning to Alpha preserves the new draft, and its next message creates another conversation without the old history. The navigation epoch distinguishes repeated selections of the same draft id.
- `/new` opens a fresh conversation in both compact and full-panel views. Protocol readback verifies separate history rather than relying only on an empty screen.
- A loaded chat losing its connection shows a gray presence dot, disables sending and model selection, and displays Not connected to APX / Sin conexión con APX with Retry. Retry is exercised while the core is unavailable; reconnect restores the actual conversation. A disconnected model says Unavailable / No disponible, not No models / Sin modelos.
- An online core with no configured providers shows the no-model explanation without empty search or unused configuration controls. Existing inheritance, effort and automatic-selection semantics remain intact.
- The extension requests only `sidePanel`, with no website permissions, content scripts or external messaging. Cross-origin DOM access is refused, the wrapper has no APX token, its direct network requests are blocked by CSP, and the core rejects direct extension-origin RPC even with a valid scratch token.
- The exact extension and same-origin frames may display the core-served panel; an unrelated local embedding page is blocked. Vite serves its own HTML and does not inherit this core policy.

## Independent and real-runtime evidence

Independent functional review reproduced and revalidated `/new` in compact and full-panel views. Independent security review reproduced the delayed-selection races and revalidated five navigation variants after the epoch correction, including fresh-message readback into a separate thread. The framing policy was independently exercised against hostile pages, a different extension id and a copied public identity. Copying `manifest.key` can reproduce the origin: it is not authentication of code or author.

Native Chrome side-panel opening and interactive English/Spanish lateral-width journeys were independently reviewed, including selection, cancellation, errors and reconnect. The designer accepted the known initial-load limitation below. This approval is not a complete screenshot matrix of every state at every width or verification of the integrated build.

A separate isolated run used the generated extension and an actual local Ollama provider, without an injected scripted LLM or Claude/Codex discovery. The reply was visible in the conversation and protocol readback confirmed the selected agent/project and completed native-harness run. This proves one local-provider journey, not a paid/remote provider or every model. Separate isolated Electron checks exercised the main panel, browser node and quick chat against the framing policy; their replies were scripted and they do not replace post-integration verification.

## Known initial-load limitation

If APX is unavailable before the frame loads, Chromium shows its own gray failed-frame page. Help / Ayuda, Reload / Recargar and Open APX in a tab remain accessible outside it. Help is manual and closes with Escape; there is no permanent recovery banner.

A disposable Chromium comparison in English and Spanish confirmed that successful loading and refused navigation both emit `load`, emit no iframe `error`, and deny parent DOM access with `SecurityError`. The wrapper cannot distinguish these outcomes reliably. No timeout-based error label, network probe, parent/frame bridge or extra permission was added. The designer accepted manual recovery for this first scope; do not present Chromium's placeholder as a custom APX error state.

## Integration and remaining scope

The candidate has not been integrated or released. Full verification and post-integration build/runtime checks remain required. The running daily core was inspected read-only; it was not restarted, connected to a test fixture or used for a chat. The extension was not installed in the owner's profile.

Voice, downloads, external sign-in, daily-profile storage policies, every theme/language combination and a remote/paid provider remain unverified. The extension does not inspect, share, group or operate tabs. The earlier native-host laboratory is separate and is not bundled or installed by this extension; its outstanding integrated journey is not covered here.

The desktop quick-chat agent picker has an owner-news entry and English/Spanish desktop documentation. The unpacked Chrome development preview is not offered as an installed or released feature.

**Docs impact: updated** — `README.md`, `README.es.md`, this report and the English/Spanish desktop device guides cover the actual workflow, permissions, troubleshooting and remaining limitations.

## Tab control (0.2.0)

- `control.test.ts` runs the whole path in a disposable Chromium profile: the core registers `apx chrome-host` in that profile, the real worker connects over native messaging, a message written in the panel opens a fixture page in the "APX" group and reads it back through the debugger. It also moves the tab out of the group and back in (a regression for a stale debugger attachment, which fails without the fix), refuses an APX tab dragged into the group, and checks that the same words sent from outside the panel touch no tab.
- `apps/terminal/src/chrome-host/host.test.ts` covers the host against a fake Chrome: group-only listing, the address guard before any tab opens and on every document request, the owner's Cancel, refusals, framing and origin checks. `apps/core/src/rpc/browser-chrome.test.ts` covers routing (Chrome turn → Chrome node; other turns → APX's browser; Chrome missing → the agent is told) and `apps/core/src/nodes/chrome-host.test.ts` the registration.
- UNVERIFIED: the owner's own Google Chrome profile and a store-installed build; Brave, Edge, Arc and Linux; screenshots of a tab behind others in a visible window; the host's reconnect loop against a core that restarts; Windows (not supported: it needs the registry).
