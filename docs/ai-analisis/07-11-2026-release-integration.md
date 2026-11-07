# Release integration review

## Current behavior and evidence

The fork starts at `043b02fe` and includes multi-account channels, a default responsible agent per channel, project routing and super-agent fallback. The worktree is clean. The upstream `v2.13.1` tag has 367 commits beyond the common ancestor; the fork has four. Node 24.15 is available; dependencies are not installed.

## Recommended design and affected areas

Merge the exact upstream tag into `chore/integrate-v2.13.1`, preserving both histories. Review channel management, inbound routing, thread persistence, turn routing, protocol channel configuration and web channel forms. Keep the fork's code-server launcher. Architecture impact: LOCAL integration; no new protocol path is proposed.

## Constraints and risks

Preserve independent channel identities and responsible agents, project scope, owner authorization and super-agent fallback. Upstream splits message persistence out of the thread repository and adds schema migrations. Resolve overlapping changes semantically. Do not run migrations against an existing owner home or connect real messaging accounts during automated checks. No publication or remote push is part of this task.

## Verification plan

Install frozen dependencies; inspect merge conflicts and the fork-to-upstream diff; run static checks and channel/routing regressions. Build the panel and start a loopback core with a fresh development home. Confirm status and the expected code revision. Live WhatsApp sessions and visual review remain explicitly unverified until exercised.

## Owner decisions

The owner requested a new branch and local validation. Reuse the clean current checkout. Real account pairing and final production data migration remain manual validation steps.

## Documentation impact

Docs impact: updated — this review records integration evidence and local startup instructions; retain the fork's existing English and Spanish channel guides.

## Integration findings

The merge produced two documentation conflicts, in the English and Spanish channel overview. Keep account-local chats and responsible project agents rather than upstream's Home routing. The code-server launcher remains unchanged.

The broader channel suite reproduced eight failures: six reply-routing tests and two owner-relay tests assumed inbound owner messages shared Home. Update their fixtures and thread assertions to the account chat while retaining their approval, reply destination, restart and authorization assertions.

One failure also exposed a product integration gap: upstream's new delivered-question context ran only in Home. Preserve that context for the super-agent in its owner channel chats. Do not give project agents or sealed contact chats owner-wide notices. The existing first reply-routing test reproduces the missing context before the fix. A new two-account WhatsApp regression checks distinct project agents, histories, outgoing destinations, Home separation and absence of private owner notices from project model inputs.

Before editing the oversized turn module, move context preparation into `engine/turn-context.ts`; `turn.ts` now stays below 800 lines. This is an internal split using type-only references back to turn types; no new runtime entry point or protocol method is introduced.

## Verification evidence

- Windows, Node 24.15.0, pnpm 11.25.0; frozen dependency install succeeded without lockfile edits.
- `pnpm build:web`: passed. Existing bundle-size warnings remain.
- `pnpm preflight:static`: passed again on the final context fix, including privacy, schema, lint, UI/dead-code gates, workspace types and test quality. Existing lint warnings remain; no gate was changed.
- Protocol tests: 97 passed. Panel unit tests: 297 passed.
- Initial affected channel tests: 77 passed; expanded suite exposed the eight integration failures above.
- Final focused owner-relay, reply-routing, multi-account and meanwhile tests: 16 passed, zero failures/skips.
- Final full selection, `node --test --test-concurrency=1 "apps/core/src/channels/*.test.ts" apps/core/src/engine/meanwhile.test.ts apps/core/src/engine/context.test.ts`: 320 passed, zero failures/skips. A prior concurrent run passed 313 tests but two test processes exited without per-test diagnostics. Both affected files also passed separately (7 tests). The sequential final run is green without additional product or test changes; the cause of the concurrent process exits remains unresolved.
- Isolated loopback core on port 7450 serves the built panel and health endpoint (HTTP 200). `channels.list` returned the same empty account list over HTTP and WebSocket. No real account was connected. The handoff additionally checks the running revision after restarting on the merge commit; this does not exercise a live model or messaging service.

## Limits and rollback

Risk: MEDIUM, because this integrates upstream schema and runtime changes. Existing owner data was not migrated. Full preflight/verify, desktop and phone screenshots, independent review, real model credentials and live WhatsApp pairing are UNVERIFIED. Ready for isolated owner testing only, not a production release claim.

The previous fork branch remains `main` at `043b02fe`. Stop the isolated review core before switching branches. The disposable review home is separate; do not run older code against a database migrated by this version. No remote push or installer publication is performed.

Local startup and manual validation are documented in English and Spanish in `docs/ai-test/local-validation.md`.
