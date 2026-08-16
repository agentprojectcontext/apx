# 99 — Handoff

> Written so a fresh session can continue without reading the originating chat.
> Keep it current: update it at the end of every phase, not at the end of the work.

**Last updated:** 2026-08-16 · **Branch:** `feat/profiles` · **Base:** `main` @ 1.74.1

---

## Where things stand

| Phase | State |
|---|---|
| 0 — recon | ✅ `00-findings.md`, reviewed and accepted |
| 1 — C1 `routine.id` | ✅ **merged to main**, PR #38 |
| 2 — profiles subsystem | ✅ PR #39 open on `feat/profiles` |
| 2.5 — rename, install gate, channel overlays | ✅ on `feat/profiles` |
| 4 — bundled Secretary profile | ✅ on `feat/profiles` |
| 3 — C2 cross-project tasks | ⬜ **next** |
| Inbox → responsive → LAN bind | ⬜ queued, see `04-BACKLOG-agent-inbox.md` |
| 5-9 (commitments, nudge budget, signals, calendar, service) | ⬜ per `03-BACKLOG.md` |

`npm run preflight` green at 749 tests. Docs site builds (`cd docs && pnpm build`).

**Note the phase numbers are out of order on purpose.** Phase 4 was pulled forward ahead of
Phase 3 because the owner asked to see a profile working end to end. Phase 3 is next.

---

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

## What to do next

**Phase 3 — C2 cross-project task aggregation** (`02-SPEC-capabilities.md § C2`).

Why it is next and not the inbox: the inbox needs a cross-project "all agents, most recent
first" reader, which is the same aggregation. Doing C2 first makes the inbox a second
consumer instead of a parallel implementation.

- Today `listTasks(storagePath)` (`core/stores/tasks.js:171`) folds one project's whole JSONL
  history per call. There is no cross-project reader anywhere.
- Add aggregation over registered projects returning tasks with `project_id` and
  `project_name` attached; filters for state, sub-status, tags, agent, `due_before`,
  `updated_since`, limit.
- Surfaces: `apx task list --all`, `GET /tasks?scope=all`, a panel view.
- Per-project behaviour must not change.
- Measure before caching. If caching is needed, the natural key is
  `(storagePath, mtime of the tasks dir)` and only the daemon should hold it.

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
