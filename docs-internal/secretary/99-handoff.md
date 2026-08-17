# 99 — Handoff

> Written so a fresh session can continue without reading the originating chat.
> Keep it current: update it at the end of every phase, not at the end of the work.

**Last updated:** 2026-08-17 · **Branch:** `feat/secretary-phases-5-9` (not merged) · **Base:** `main` @ 1.78.0

---

## Where things stand

| Phase | State |
|---|---|
| 0 — recon | ✅ `00-findings.md`, reviewed and accepted |
| 1 — C1 `routine.id` | ✅ **merged to main**, PR #38 |
| 2 — profiles subsystem | ✅ **merged to main**, PR #39 |
| 2.5 — rename, install gate, channel overlays | ✅ merged (in #39) |
| 4 — bundled Secretary profile | ✅ merged (in #39) |
| 3 — C2 cross-project tasks | ✅ **merged to main**, PR #40 |
| Inbox — core + `GET /inbox` | ✅ PR #41 open |
| Inbox — panel UI (`/m/inbox`) | ✅ PR #41 |
| Inbox — responsive | ✅ PR #41 (one known gap, below) |
| LAN bind — `apx panel share` | ✅ PR #41 |
| 5-9 (commitments, nudge budget, signals, calendar, service) | ⬜ per `03-BACKLOG.md` |

`npm run preflight` green at 778 tests. Docs site builds (`cd docs && pnpm build`).

**Note the phase numbers are out of order on purpose.** Phase 4 was pulled forward ahead of
Phase 3 because the owner asked to see a profile working end to end. Phase 3 is next.

---

## Owner corrections applied late (do not undo)

- **System prompts are English, always.** Spanish is a UI language only. A translated
  `PROFILE.<lang>.md` is a second prompt that drifts; the agent is told to reply in the
  owner's language instead. The bundled Secretary is English-only and a test pins it.
  The multi-language machinery stays for third-party packages.
- **`.apc/` no longer carries `commands/`**, and whether `config.json` belongs there is an
  open question — check the canonical layout in
  `/Volumes/SSDT7Shield/proyectos_varios/agentprojectcontext/apc`. The uncommitted edit in
  `skills/apc-context/SKILL.md` is RECOVERED content, not a regression; it is the owner's to
  land and must not be reverted. (`scripts/sync-apc-skill.js` runs on `prepack`, which is
  why it keeps appearing in unrelated diffs after any `npm pack`.)
- **Remote access means LAN, not a public tunnel.** See "Answers already given" below.

## Decisions that are NOT in 01/02-SPEC

These were taken during implementation and approved. `00-findings.md § 8` has the full
reasoning; this is the short list so nothing gets silently reverted.

1. **The subsystem is `profile`, not `persona`.** `persona` already means the super-agent's
   visible name (`identity.json.agent_name`, AGENTS.md rule 4). Never conflate them.
2. **Bundled packages live in `src/core/profiles/bundled/`**, not `assets/`. `assets/` is not
   in package.json `files` and does not ship to npm.
3. **Installing a bundled package does not copy it.** Only a local-path install copies.
   Copying a bundled package would freeze the user on today's content.
4. **Settings are per profile** (`config.profile.configs[<id>]`); `config.profile.config`
   mirrors the active one and is `{}` when nothing is active.
5. **The install gate is the defence, the renderer only the net.** Installation fails,
   naming the variable, on any template variable that cannot resolve.
6. **Channel overlays** (`channels/<ch>.md`) are a core capability. The interruption gates
   live in `channels/routine.md`, NOT in an on-demand skill — a guardrail cannot depend on
   the guarded party choosing to fetch it.
7. **Neutral fallbacks are language-aware and follow the file that was selected**, not the
   language requested.
8. **The prompt budget is enforced per language.**
9. **Routine migration lives outside `readFile()`** — that helper is on the scheduler's 5s
   polling path.
10. **C5's gate does not go in the transport.** `_send` also carries solicited replies. The
    gate belongs in the four push callers with an explicit `unsolicited` flag, and the
    Phase 6 PR must carry a grep audit proving all four pass through it.

---

## Corrections to 02-SPEC discovered in Phase 3

`§ C2` says cross-project aggregation does not exist. **Outdated** — `GET /tasks` and the
panel's `GlobalTasksTab` already shipped. What was genuinely missing was that the fold lived
in the daemon route rather than core (so the CLI could not reuse it), and the sub-status and
`updated_since` filters. Corrected in place.

It also missed that **`apx task list` was broken outright**: the endpoints answer a
`{meta, data}` envelope and the CLI still treated it as an array, so it printed "(no tasks)"
regardless. Only live verification found it.

## 🔴 Open right now — read this first

**1. The model chain degrades to something unusable, many times a day.** From `~/.apx/daemon.log`:
46 `engine_failed` events — 9 × `gemini 429` (quota exhausted, a billing matter), then 17 ×
`groq 413` (**request too large**: 17k tokens against a 12,000 TPM limit), landing 22 times
on `openrouter:openrouter/free`, which answers with raw chain-of-thought.

Telegram turns measured: **average 40,650 input tokens, peak 66,440.** The first fallback
cannot serve any of them. The Secretary profile is ~600 of that — not the cause, but not
helping either. The leak is now suppressed in code, but the chain still needs the owner's
decision: fix Gemini billing, or put a fallback in that can take a 40k prompt, or shrink
what goes into a turn.

**2. ~~`POST /pair/init` is broken~~ — RETRACTED. It works.** `POST /api/pair/init` answers
correctly, with the 5-minute TTL. This branch's refactor moved every data route under
`/api`; calling the bare `/pair/init` falls through to the SPA, which is why it looked
unauthorized. My test was wrong, not the product. Recorded because the retraction matters
more than the original claim.

**3. `tests/smoke/seam.smoke.js` needs adapting and is NOT in CI.** Same root cause: written
against the pre-refactor layout. The `/api` prefix is applied, but five tests still fail
against a freshly-booted daemon while the identical calls succeed by hand and against a
hand-rolled fresh daemon. Unresolved. It must not go into CI until those five pass — a suite
that fails for its own reasons trains people to ignore it, which is worse than not having
one.

## 🔴 Live finding the owner must decide on

**This machine's daemon is bound to `0.0.0.0` right now** — `config.host` is
`"0.0.0.0"`, and `lsof` confirms `TCP *:7430 (LISTEN)`. It is pre-existing config, not
something this work introduced, and it was deliberately NOT changed: it may be what the
owner already relies on to reach the panel from their phone, and silently narrowing it
could break that.

It is worth a decision, because it is wider than it needs to be — a wildcard bind also
covers interfaces that appear later (a VPN, a hotspot, a container bridge). `apx panel
status` now reports this case separately from ordinary sharing and points at the narrower
option:

    apx panel share      # bind one specific LAN address instead
    apx panel unshare    # back to loopback only

## Known gap

`line-clamp-2` has no effect in this Tailwind build, so a long inbox preview renders in
full on a phone rather than clamped to two lines. Bounded anyway — the preview is capped at
160 chars server-side — and the full short reply arguably reads better on mobile. Worth
resolving with the wider responsive pass.

## Scope deliberately cut

- **Friendly schedule config.** The Secretary's schema takes plain five-field cron
  (`day_open_schedule: "30 8 * * 1-5"`) rather than `day_open_at: "08:30"` + `work_days`.
  Converting time+days to cron is real logic, not template substitution, and it would need
  its own derived-variable path through the install gate. A schedule that stores but fails
  `parseSchedule` is a routine that silently never runs, so the safe version shipped and the
  friendly one is a follow-up.
- **Specialist agents in the Secretary package** (`agents/*.md` — product, marketing,
  commercial, finance, research). The package ships without them; `03-BACKLOG.md` Phase 4
  lists them. Not blocking, add when the delegation story is exercised.
- **Capture and re-entry skills** (`apx-secretary-capture`, `apx-secretary-briefing`). Same
  reason — the on-demand third of the split is not written yet.

---

## Owner's standing instructions

**Decide alone:** internal design, naming, file and test structure, refactors; spec
corrections (write them into `00-findings.md`); opening AND merging own PRs *if* preflight
is green, new tests cover the change, and it was verified against the live daemon — not just
unit tests; cutting scope when something becomes a pit (note what and why).

**Stop and wait:**
- any bind outside `127.0.0.1` that would be active BY DEFAULT
- publishing to npm
- deleting or irreversibly migrating user data
- loosening a guardrail (interruption budget, outward-write permissions, confirmations)
- force-push or history rewrite on `main`
- project-first navigation losing functionality

---

## Answers already given (do not re-ask)

- **Order:** 3 → 4 → inbox → responsive → LAN bind.
- **Inbox vs projects:** they COEXIST and are two different axes. The inbox is the default
  entry point (conversations, most recent first); project navigation stays intact and must
  not degrade — it is APX's differentiator against any personal assistant. *Conversational
  entry, project structure. Both.*
- **Super-agent in the inbox:** pinned, always first, visually distinct. The hierarchy
  should be visible.
- **Remote access means LAN, not a public tunnel.** Bind the daemon to the LAN interface in
  addition to loopback and print the real URL (e.g. `http://192.168.1.40:7430`). No
  cloudflared, no localtunnel. `127.0.0.1` stays the default, LAN bind is explicit opt-in, a
  loud command prints IP + port + one line on what is now reachable, existing token/pairing
  auth stays mandatory, never `0.0.0.0` by default. A terminal QR is a nice-to-have if
  cheap. The public-tunnel objection is ARCHIVED, not discarded — see
  `04-BACKLOG-agent-inbox.md § C`.
- **Second factor:** not for LAN; the existing pairing/token is enough. Reopen if public
  exposure ever happens.
- **Chat view details approved:** agent preview shows its RESULT not the user's prompt; tool
  summary rendered from `tool_trace`; "routine created" chip on recurring requests.

## Constraint raised late — do not lose it

**Per-project agents each have their own Telegram option** — a direct channel to talk to
that agent without going through the super-agent. The owner has never used it, but it must
NOT be removed or degraded by the inbox work. Treat it as another entry point into the same
conversation, not as something the inbox replaces.

---

## Bugs found and fixed along the way (none were in the specs)

| Bug | Where |
|---|---|
| `apx task list` printed "(no tasks)" always — CLI treated a `{meta,data}` envelope as an array | merged, PR #40 |
| `parseConversation` truncated every multi-line turn to its first line (`$` under `/m`) | PR #41 |
| Pages deploy failed on every docs change — `pnpm install` in `docs/` installed the root project | PR #41 |
| Profile config mirror went stale on `off`/`uninstall` | merged, PR #39 |
| Prompt budget only checked English | merged, PR #39 |
| Neutral fallback was English-only, and followed the requested language rather than the resolved file | merged, PR #39 |

Every one was found by running against the live daemon, not by unit tests.

## What to do next

### Done since
- Phases 0-4, plus C2 (Phase 3), all merged to main.
- Reasoning-leak guard (`stripReasoning`) — merged on this branch, not on main.
- Pairing double-confirm fix — **merged to main as PR #44**, and NOT present on the
  `repair-and-refactoring-code` branch. Pull main in or it will not take effect.

### NOT built — the whole remaining backlog

The owner asked for phases 5-9 plus the two inbox items in one round. That did not fit, and
splitting attention across five phases would have produced five half-features. What exists
is the plan below, unstarted:

| Phase | What | Note |
|---|---|---|
| 5 | Commitments as a first-class store | `02-SPEC § C3` — separate store, NOT a tag on tasks |
| 6 | Interruption budget | `§ C5` — **before 7, non-negotiable.** Gate goes in the four push callers, never in `_send` |
| 7 | Signals + `watch` routine kind | `§ C4` — deterministic detection, LLM only when a signal fires |
| 8 | Calendar | `§ C6` — MCP first, native adapter later |
| 9 | Daemon service + memory consolidation | `§ C7`, `§ C8` |
| — | Inbox: tool summary from `tool_trace` | data is on disk, rendering only |
| — | Inbox: routine-created chip | |
| — | Inbox: split view (list + live chat) | The owner is right that it should embed `/p/0/chat`, not navigate away |

Still not built, both explicitly wanted:

1. **The tool-run summary in a thread**, rendered from `tool_trace` in message meta
   (`✓ Salesforce → 52 accounts`). The data is already on disk; this is a rendering job.
2. **The "routine created" chip** when a recurring request turns into a routine. APX
   already creates the routine — showing it closes the loop at the moment it happens.

Then the remaining phases in `03-BACKLOG.md`: 5 (commitments), 6 (nudge budget — **before**
7, non-negotiable), 7 (signals/watch), 8 (calendar), 9 (service + memory consolidation).

**Do not break:** each project agent has its own Telegram line, a direct channel that
bypasses the super-agent. Never used so far, but the inbox must not remove or degrade it.

C2 is done and is the foundation: `listTasksAcrossProjects()` in `core/stores/tasks.js` is
the shape the inbox's "all agents, most recent first" reader should follow — walk the
registered projects, attach `project_id`/`project_name`, sort with a deterministic tiebreak,
cap after the merge.

Things learned in C2 that apply directly to the inbox:

- **`nowIso()` has second resolution.** Anything sorted by time needs a tiebreak or the list
  reshuffles between identical calls.
- **The list endpoints answer `{meta, data}`.** `apx task list` was broken for exactly this
  reason. Check any new CLI reader against the live daemon, not just core.
- **Skip, name, and carry on.** One unreadable project must never blank out a cross-project
  view; return what was skipped so the surface can say so.
- **Measure before caching.** 24,000 tasks across 10 projects folds in 22ms, so C2 has no
  cache. The inbox should measure the same way before adding one.

---

## Working notes

- The running daemon serves this checkout; run `apx restart` after JS changes. New **files**
  (a new bundled profile) are picked up without a restart.
- Verify against the live daemon, not just unit tests — the stale-config-mirror bug and the
  language-fallback bug were both found that way.
- `node scripts/inspect-channel-prompts.js` gives real per-channel token costs. With the
  Secretary active: telegram 3094, routine 3549 (vanilla was 2486 / 2479).
- Never paste CLI or panel output into commits or fixtures — real routine prompts in this
  install contain API tokens (AGENTS.md rule 3).
