# Native agent cursor preview

Status: task worktree only, not integrated or released. The current contract keeps the owner's physical pointer
under the owner's control during native accessible presses. The preceding two-movement experiment and its video are
superseded, not evidence for the final interaction. The updated fixed-window video is complete. Final joint review
found cancellation and uncertain-delivery failures in the legacy physical fallback; physical mouse fallback is now
disabled on macOS, as explicitly chosen by the owner. QA and security closed those findings statically; neither
reviewer executed tests or supplied an integral product approval. Final verification remains pending.

## Interaction

The macOS Desktop uses its bundled Swift helper in private `--pointer` mode. It persists across actions and owns
non-activating, click-through, capture-protected overlay windows, one per agent (bounded to sixteen). Only the drawn
cursor travels. Its quadratic curve uses a perpendicular control offset of 20% of the travel distance, with native
Core Animation easing over 300–700 ms. Travel accelerates and brakes with a pronounced ease-in-out curve;
a bounded scale spring (96–103.5%) gives the drawn badge a soft start and settling bounce without overshooting the
position target or extending the action deadline. macOS Reduce Motion skips both travel and scale animation.
The physical pointer is neither sampled as the start nor moved by this mode.

The arrow is 60% of the previous size (about 20 points), white with the original green edge and glow. Three sparks
repeat the original staggered opacity/scale animation; a green ring pulses on successful activation. An almost-black
rounded label has no colored border, uses 11-point semibold white text and says the action. Stored agent names supply a short prefix;
operator calls show their action note, with action-specific click/typing defaults when no note is available. Core derives identity from the turn, not
public tool input. Windows retains the existing Electron cursor.

`computer.click` accepts optional `pointer: "visible"`; `screen_do` forwards it only to clicks. In this mode, the
Desktop performs one native AXPress without moving the physical pointer. The core routes it only to nodes advertising
`computer.pointer`, preventing an older node from silently treating it as a legacy click. Omission retains the existing
coordinate accessibility path. Physical mouse fallback is disabled on macOS: unsupported controls require the owner
to click. This avoids leaving a button held or a pointer displaced when a subprocess is killed during delivery.
A delivered accessibility error is uncertain, never permission for another action. No new transport, agent-accessible helper or permission
is introduced.

## Final visual refinement evidence

The final refinement adds acceleration, braking and a subtle scale-only settling bounce, removes the action label's
colored border and preserves the smaller arrow and animated sparks. The owner approved the visual direction.
The native harness passes 25 behavioral cases, plus three platform-runner checks. The final production helper,
compiled through the Desktop builder, delivered two AXPress actions in 1216/580 ms through an isolated core and
Desktop node; the fixture counter reached two, with zero physical mouse-downs and identical before/after pointer
positions. Disabled and secure controls and a post-Stop request were refused. These are fixture measurements,
not comparative performance claims. The running core reported the base revision plus the uncommitted visual delta.

A separate capture-enabled helper recorded the borderless badge and curved travel; its only capture difference is
`POINTER_RECORDING`. During that recording the physical pointer changed between samples, so the video does not
establish that it stayed still. The production run's unchanged samples are separate evidence. General verification
remains incomplete: the remaining suites did not start because the bounded wait for another worktree's gates expired.

## Destination and lifecycle

- The system-wide AX hit must belong to the named process. Process launch, retained AX window/control/ancestor identity,
  CG window geometry and enabled state are checked immediately before the action.
- A complete bounded ancestor chain is classified before action selection. Web content, secure/unclassified fields,
  foreign owners, cycles and unavailable ancestry refuse. There is no physical fallback in native accessible mode.
- AX input-target hit testing ignores click-through overlays. The helper's own window IDs are excluded from CG window
  matching. The physical pointer may be outside the window; no origin, route, rest or arrival checks are used.
- Calls are serialized per Desktop. Legacy clicks share the gesture gate and AbortSignal, including their idle wait.
  Stop rearming cannot revive a queued action from an earlier epoch.
- Stop, off and disconnect terminate the helper and retire pending/queued commands. An in-flight action keeps the gate
  until child close. Delivered effects cannot be withdrawn; uncertain outcomes are not retried.
- JSONL uses inherited private pipes, bounded framing, correlated replies and deadlines. There is no listener, shell
  input or parallel protocol path. The core router, authorization and node broker remain authoritative.

## Regression protection

Focused tests cover core approval and identity spoof rejection, native process persistence/captured labels, queued
cancellation, close-before-release, invalid results/no retry, injected deadlines, legacy overlap/stop races and clipped
screenshots with negative origin and unequal X/Y scaling. Final-review regressions also cover empty/whitespace
field subroles, JXA callable process collections, effects followed by accessibility errors, physical fallback refusal
before process launch or app activation, and action labels without a note. The native Swift harness has 24 cases for a stationary
physical pointer, one press, replacement/cancellation/refusal, curve geometry, duration bounds and secure/web roles.

The screenshot transform uses the actual captured intersection and separate X/Y ratios, including after resize, not
the original full-window bounds. The previous JXA trajectory experiment was removed rather than retained as a second
native action path. The earlier Electron overlay-load race remains covered for the Windows cursor implementation.

## Runtime and limits

The isolated core on port 7488 reported checkout HEAD `3a174f1af0ed` with the implementation delta. A windowless Electron
lab exercised SDK → core router → node broker → the real Desktop dispatcher/driver/helper, not the full Desktop shell
or a model-generated tool turn. The final curved-overlay recording measured two accepted AXPress actions at 714/561 ms
end to end; disabled/secure targets refused at 424/398 ms and stop refused at 2 ms. The counter stayed at two, with zero
physical mouse-down events in the fixture. Before/after readings of the physical pointer were on another monitor and
changed during this recording; this is not proof that the owner's mouse stayed still throughout. The native action
backend has no pointer-movement operation; the owner remains free to use their mouse. A preceding instrumented run
also recorded unchanged before/after positions, but preceded the final local-layer geometry correction.

The corrected canvas uses AppKit's flipped view coordinates, without flipping the badge again. Actual video frames
were checked against the control center and the reference; both mirrored canvas and mirrored badge failures were
caught in runtime before delivery. The recording is `product-lab/curved-agent-cursor.mp4` in task scratch evidence,
with a final captioned copy for delivery. Both native presses changed the actual fixture counter; screenshots alone
are not the activation evidence.

The final production helper was built through the actual Desktop packager (no recording flag). A separate run
measured accepted presses at 554/501 ms, disabled/secure refusals at 395/386 ms and stop at 2 ms. Its counter stayed at
two with zero physical mouse-downs; physical pointer readings before/after were identical on another monitor.
A production capture confirmed the overlay was excluded. The final focused command passed 79 tests, including the
19-case native Swift harness. No mean, percentile or speedup is inferred from these individual samples.

The fixture stays at one announced fixed location and records physical mouse-downs. Its secure value is synthetic and
read-only. An earlier uninstrumented trial had a late extra increment and unexplained external-looking field input;
that trial is excluded from clean evidence. No private field contents were logged or read.

Production builds exclude the indicator from screenshots. `POINTER_RECORDING` only makes that same synthetic native
indicator recordable; it changes no action validation, geometry or timing. Packaging never enables the flag. A final
recording must disclose it, show the current curved indicator and stationary physical pointer, and include measured
per-action latencies. This is not a paired performance benchmark or proof for all applications.

After the final-review fixes, a freshly packaged production helper and rebundled Desktop lab repeated the real path
against a fresh isolated core reporting `3a174f1af0ed` plus the final delta. Accepted presses measured 1140/516 ms;
disabled/secure controls refused at 406/387 ms, Stop refused the subsequent action, the counter ended at two and
physical mouse-downs stayed at zero. The lab and its core were closed. This run validates the final classification
change; it is not a new video, a benchmark or evidence for unexercised application families.

General Electron/browser, menus, localization, stale references, unavailable AX and missing-permission benchmarks remain
UNVERIFIED. Runtime evidence here is macOS only; Windows and Linux are UNVERIFIED. Windows keeps its existing driver
and indicator; Linux computer control remains unsupported. No cross-platform success is inferred from macOS. The observation/ref experiment is still private and unconnected to agent tools. No marketing success rate
or universal latency improvement is claimed.

Docs impact: updated — this report, Desktop guides EN/ES, computer skill, native README, human model and next-release
news describe the changed process, behavior and limits. The native harness reports unsupported on Windows/Linux,
not a skipped test or a claim of native success; macOS compiles and runs all 24 Swift cases. The platform-reporting
wrapper adds two unsupported-platform checks. The verification job was reported cancelled after a development-service
restart while unit suites were active. Its log contains pending-promise failures; two affected web files passed
independently afterward, without establishing the cause of every failure. This is not a green full-gate result. Typecheck (workspace, e2e and prototype), privacy, schema, lint and test-quality gates passed; remaining
suites continue from the interrupted step. No new dependencies; AppKit, QuartzCore and ApplicationServices
are operating-system frameworks. No merge, push, release or daily-core restart is part of this delivery.
