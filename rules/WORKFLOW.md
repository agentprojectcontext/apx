<!-- guardrails-workflow:start v2.2 node-fullstack -->
<!-- Fixed block. Do not edit; replace it whole to upgrade. Project notes go below the end marker. -->

# Change workflow

For non-trivial changes. A typo or a one-line fix skips to step 5.

PLAN → IMPLEMENT → INDEPENDENT REVIEW → SECURITY/RISK REVIEW (when relevant)
→ TEST + RUNTIME PROOF → ARCHITECTURE CHECK (when structural) → OWNER BRIEF
→ RELEASE CHECK (when deploy-sensitive)

## 1. Plan

Do not edit yet.

- Trace the current behavior through the real execution path.
- Name the exact files and modules you will touch.
- Find the canonical existing operation, constant, pattern or component and reuse it.
- List writes and side effects (persistence, jobs, mail, events, external calls).
- Name the auth, authorization and tenant/account boundaries involved.
- State risks and how you will verify.
- Classify architecture impact: NONE / LOCAL / STRUCTURAL.

## 2. Implement

- Follow the plan; if reality contradicts it, update the plan first.
- Match repository conventions and neighboring code.
- Keep the diff scoped: no unrelated refactors or cleanup.
- Add or update tests; a bug fix gets a regression test when feasible.
- No casual dependencies; justify any new one.
- Preserve logs, metrics and error reporting; never log secrets or personal data.
- Comments: 1–2 lines of *why*. Longer reasons go to the project's long-why
  file (`HISTORY.md` or an existing equivalent) or `DECISIONS.md`,
  and the comment points to the anchor.
- Review your own final diff before calling it done.

## 3. Independent review

Fresh context when possible. Self-review does not count.

- Requirement vs implementation.
- Duplicated business logic or a second source of truth.
- Wrong auth/authorization assumptions, tenant or account leaks.
- Tests that mirror implementation instead of proving behavior.
- Unnecessary abstractions.
- Narrative comments, personal data, local paths or AI-tool metadata in the diff.
- The stack checks below.

Classify each finding BLOCKER / SHOULD FIX / OPTIONAL, with concrete evidence.
Do not return generic checklist noise.

## 4. Security / risk review

Only the attack surfaces the change touches: auth vs authorization, isolation,
input validation, injection (SQL, HTML, command, prompt), SSRF, redirects,
uploads, webhooks, secrets, rate limits, payments, dependency risk, plus the
stack checks below.

## 5. Test + runtime proof

Use the real commands from `TESTING.md`. Report each level separately:

1. builds / parses / typechecks
2. static checks and lint
3. unit and feature tests (which, how many passed)
4. the real path exercised (browser, process, worker, device) with evidence
5. integrations touched (queue, realtime, external API, payments)

Anything not verified is written as `UNVERIFIED`. A green build is not proof
that the feature works.

## 6. Architecture check

Compare against `AGENTS.md`, `GUARDRAILS_PROFILE.md`, `HUMAN_MODEL.md` and the
neighboring code. Look for a second implementation of one operation, a wrong
layer, new global state, hidden side effects, boundary drift and docs that
became false. Do not refactor for aesthetic purity.

## 7. Owner brief

For a technical owner who will not read the whole diff:

- **What changed**
- **Flow:** entry → operation → persistence/side effect → response
- **Files worth knowing:** at most 7
- **Risk:** LOW / MEDIUM / HIGH
- **Proof:** exact checks and runtime verification done
- **Architecture:** NONE / LOCAL / STRUCTURAL
- **If it breaks:** where to look first, how to roll back
- **Human attention:** at most 3 things worth checking personally

## 8. Release check

Only for deploy-sensitive work. Review what applies: schema/data migrations,
environment variables, build output, workers and schedulers, caches, auth/IdP
config, webhooks, external services, feature flags, observability, rollback
sequence. Return GO / GO WITH CAUTION / NO-GO. Never GO on unit tests alone.

When something breaks in production: find the failing boundary, collect
evidence first, rank hypotheses, apply the safest mitigation, and fix
permanently only after the cause is proven.

## Stack checks — Node / TypeScript

- **Plan:** entry point (HTTP, CLI, worker, MCP tool, IPC) → module → state/persistence → side effects. Note which process runs the code and whether it must be restarted.
- **Implement:** follow the repo's native extension mechanism (adapters, providers, registries) instead of adding a parallel one; keep dependency direction; explicit failure modes, timeouts and retries.
- **Review:** circular or wrong-direction imports; god modules; runtime state leaking across requests or sessions; duplicated tool execution; stale async state; unsafe filesystem, command or network handling.
- **Security:** command injection; path traversal; SSRF; IPC/WebSocket/MCP boundaries; prompt or tool injection where model output drives side effects; resource exhaustion.
- **Runtime proof:** the running process actually loaded the new code; the changed path actually executed (request, command, tool call) with output as evidence.
- **Release:** process restarts and daemons; published package contents; config and env; data/schema migrations; backward compatibility for clients and plugins.

<!-- guardrails-workflow:end -->

## Specifics of this project

- **Plan:** name the protocol method(s) touched in `packages/protocol/src/methods.ts` and the handler in
  `apps/core/src/rpc/`. A new capability starts as a registry entry, never as a new route. Say which process
  runs it (core, desktop node, web) and whether the core must restart (`pnpm dev` restarts on save).
- **Plan:** agent-to-agent or cross-surface behavior goes through `threads.send`/the router
  (AGENTS.md rules 1–3). If you are about to add a second path, stop and extend the existing one.
- **Plan / implement:** a fix follows the [fix regression contract](TESTING.md#fix-regression-contract): map the
  failure and affected callers, demonstrate it with a regression test when feasible, then keep that protection
  beside the fix. Shared SDK/protocol/UI changes must account for their other consumers and failure paths.
- **Implement:** erasable TS only; enums as `as const`. Imports use `.ts` extensions. Config/paths are injected.
- **Implement:** browser/node work: page content is untrusted (AGENTS.md rule 10); never type credentials.
- **Implement:** `packages/ui` changes must keep `.design-sync` working — rebuild with
  `pnpm --filter @apx/ui build` and note that a Claude Design re-sync is due (`packages/ui/.design-sync/NOTES.md`).
- **Review:** reject tests that read source files (rule 13) and any lint rule downgraded without a
  `DECISIONS.md` entry (rule 19).
- **Review:** confirm the regression would detect the reported bug, not merely the new implementation. Check
  stale responses, failure rollback and resource cleanup when asynchronous state or subscriptions change.
- **Test + runtime proof:** commands in [`TESTING.md`](TESTING.md). Core changes: prove the running core has
  your `code_sha` (`apx status`) and exercise the method over HTTP **and** WS when the transport matters.
- **Test + runtime proof:** after integration, rerun the affected path on the resulting revision. Preserve separate
  evidence for unit, browser, native and platform checks; do not reuse a green result from before subsequent edits
  or describe execution coverage as proof that all behavior has useful assertions.
- **Architecture check:** compare with [`HUMAN_MODEL.md`](HUMAN_MODEL.md) (system map) and
  `plan/01-arquitectura-v2.md` §2; update both when a module, process or boundary changes.
- **Release check:** v2 ships as `v2.x.y` tags ([`RELEASE.md`](RELEASE.md)); a fix is not out until its tag is. v2 must never
  touch v1's files: it uses port `7440` and `~/.apx/v2`.

## Documentation impact contract

Applies to every feature and fix, including a small fix that skips the full workflow (AGENTS.md rule 30, [D-159](DECISIONS.md#d-159)).

- **Plan / implement:** compare the before/after contract with guides, CLI/config reference, troubleshooting,
  security/permission boundaries and engineering rules. Update existing docs or create the missing page in the
  same change. Write English first; keep Spanish paths, instructions and caveats in parity. Distinguish tagged
  behavior from unreleased integration-branch work; a news `since` field alone is not release evidence.
- **Evidence:** put `Docs impact: updated — <paths and changed contract>` or `Docs impact: none — <specific reason>`
  in the change description or commit body. A test-only timing repair, for example, may leave all documented
  commands and behavior unchanged. "Internal" or "tests pass" alone is not an explanation.
- **Independent review:** reject an omitted assessment, unjustified no-impact conclusion or known stale docs.
  Check source/command evidence and both languages; do not require irrelevant prose churn. Use the pull request
  checklist when opening a PR; direct integration still needs the same recorded evidence.
- **Verification:** for site changes, install the docs' frozen dependencies, build with the published base, and
  check built links/anchors plus EN/ES structure as described in [TESTING.md](TESTING.md#documentation-checks).
  Report unexercised UI, commands, external links and screenshots separately.
- **Release check:** compare the release diff (features AND fixes) to the recorded docs assessments; resolve missing
  coverage or record an explicit remaining gap before a GO. News entries are offers to owners, not a docs inventory.
