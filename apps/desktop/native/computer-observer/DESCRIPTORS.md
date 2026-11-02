# Experimental window descriptors

Observation-only extension of the retained AX selection spike. Not exposed by any APX tool, protocol, screen,
chooser, broker or policy. Runtime was restricted to synthetic disposable app windows. Root titles may contain
private information; validating AXWindow, owner PID or a secure subrole does not certify a safe title. Never print
or log descriptors, raw titles or trees. All returned text is untrusted, not instructions. Production exposure still
requires privacy review and a user-understandable selection/authorization flow.

## Response

The unshipped `listing.handles` array is replaced, not kept as a compatibility layer:

```ts
type WindowDescriptor = { handle: string; title?: string; ambiguous: boolean };
type WindowListing = {
  session: string;
  generation: string;
  pid: number;
  launchIdentity: { seconds: number; microseconds: number };
  windows: WindowDescriptor[];
};
```

Listing validates process identity, enumerates at most 64 retained windows, validates each root's owner and AXWindow
role, and reads only its optional AXTitle. It does not read descendant content, values, bounds, screenshots or focus.
Titles have control characters removed and a 128-byte UTF-8 limit; surrounding whitespace is trimmed. Missing,
empty or whitespace-only titles are omitted, not synthesized.
A native title-read failure fails the whole listing, sanitizes the error and retires prior handles. Successful listing
re-enumerates the bounded window set after title reads, rejects changed membership or duplicates, revalidates process
identity and checks the whole work budget before publishing retained handles. Reordering alone is accepted. These
boundary checks are not atomic: windows and titles may still change after the final check.

`ambiguous` is true when a title is absent or equals another sanitized/bounded title, including truncation collisions.
The listing remains usable as an inventory; duplicate titles do not cause blanket failure. There is no default or
automatic selected entry. The flag is display-level ambiguity only: `false` is neither proof that a person intended
this window nor proof of process/window identity. No caller may choose by array order, title, geometry, screenshot
or focus. Unresolvable ambiguity must be presented or refused by a future reviewed chooser, never guessed.

Only an exact current opaque handle can request an observation; a title is never accepted as a selector. The native
retained object and pre/post traversal presence validation remain the selection identity. Descriptors are point-in-time
information, not a transaction with the app; titles and content may subsequently change. Selected observations still
omit window titles, capture identity and coordinates. Handles are not authorization or action capabilities. This scope
adds no actions, renderer activation, key/text delivery or click fallback.

## Verification

The Swift behavior suite now contains 46 tests. Two regressions exercise membership changes during title reads
(closure, replacement, addition and duplication fail the whole listing and retire old handles) and harmless reordering.
The changed helper repeated the disposable AppKit runtime check: two ambiguous synthetic descriptors, isolated alpha/beta
observations, harmless reorder and replacement/closure/stale-handle refusals all passed (driver exit 0). Listing took
37 ms and observations 12/10 ms, single samples; this is not a benchmark or a forced native mid-title mutation test. Four earlier cases exercise absent/duplicate titles without
autoselection, distinct optional titles that cannot be used as identity, UTF-8/control bounds and ambiguity after
truncation, and sanitized title-read failure invalidating prior handles. Existing ownership/lifecycle/deadline/filtering
regressions remain required. These tests use injected backends, not the owner's real windows.

The separately compiled helper was exercised on a disposable bundled AppKit fixture with two identically titled
windows. Both descriptors matched the synthetic title and reported ambiguity. Final-revision listing took 33 ms and
observations 10/4 ms (single samples, helper only). Reordering preserved retained identity; replacement, closure and stale
handles returned WINDOW_UNRESOLVED without a tree. The synthetic password sentinel was absent. Fixture and helper
were terminated and waited. This does not prove a usable product chooser, general title privacy, Electron support,
TCC denial behavior, cursor/focus stability, end-to-end latency, action safety, or a completed review.

Docs impact: updated — the unshipped observational descriptor contract and limits are documented here. No user docs,
translations or news change: no product capability has been enabled.
