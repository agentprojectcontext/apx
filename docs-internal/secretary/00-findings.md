# 00 — Findings: Phase 0 reconnaissance

> Verification pass over `01-SPEC-personas.md` and `02-SPEC-capabilities.md` against the
> working tree at commit `aab2674` (`package.json` = 1.74.0). No code was written.
>
> Method: read every file the specs cite, ran `node scripts/inspect-channel-prompts.js` for
> real token numbers, ran `npm pack --dry-run` for real packaging behaviour, and toured the
> web panel at `http://127.0.0.1:7430`.

**Bottom line:** the specs are unusually accurate. Every load-bearing claim about
`prompt-builder.js`, `routines.js`, `runner.js`, `tasks.js` and the four Telegram push paths
checks out, several to the exact line. But there are **three blocking problems** that change
the design, not just the implementation, and I recommend resolving them before Phase 2:

1. `assets/` **does not ship to npm** — so `assets/personas/` cannot be where bundled personas live.
2. The vault is a **layered read**, not copy-at-install — spec §3 and §4 contradict each other.
3. `PERSONA.md` as written is **~1533 tokens against a declared budget of 900** — it would fail
   its own install gate, and it grows every prompt on every channel by ~60%.

---

## 1. Confirmed against the code

| # | Spec claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Block order of `buildSuperAgentSystem()` (§6) | ✅ **exact** | [prompt-builder.js:304-320](src/core/agent/prompt-builder.js:304) — the 15-element array matches the spec's listing item for item |
| 2 | `renderPromptTemplate()` already exists at line 86 | ✅ **exact line** | [prompt-builder.js:86](src/core/agent/prompt-builder.js:86) |
| 3 | Insertion point is between `buildUserContextBlock` and `customInstructions` | ✅ viable | `buildUserContextBlock` [:150](src/core/agent/prompt-builder.js:150) called at [:306](src/core/agent/prompt-builder.js:306); `customInstructions` built [:287-290](src/core/agent/prompt-builder.js:287), placed [:307](src/core/agent/prompt-builder.js:307) |
| 4 | 🔴 C1 — `upsertRoutine()` never assigns `id` | ✅ **confirmed** | [routines.js:102-126](src/core/stores/routines.js:102) — the `entry` object literal has no `id` field |
| 5 | C1 — everything collapses to `routines/_unknown/` | ✅ confirmed | [routine-memory.js:19](src/core/stores/routine-memory.js:19) `String(routineId \|\| "_unknown")` |
| 6 | C1 — `resolveRoutineRef` returns `undefined` | ✅ confirmed | [routine.js:144](src/interfaces/cli/commands/routine.js:144) returns `match.id`; nothing ever set it |
| 7 | C1 blast radius reaches the prompt | ✅ **worse than spec says** | [runner.js:121,126,127,132](src/core/routines/runner.js:121) — `routine.id` is `undefined` in all four, so the *shared* `_unknown` memory is injected into every routine's prompt as if it were its own |
| 8 | `parseSchedule()` = cron / `every:` / `once:`, no event triggers | ✅ confirmed | [routines.js:32-58](src/core/stores/routines.js:32), `cron-parser` at [:53](src/core/stores/routines.js:53) |
| 9 | `HANDLERS` = heartbeat, exec_agent, super_agent, telegram, shell | ✅ confirmed | [runner.js:189-195](src/core/routines/runner.js:189) |
| 10 | `tasks.js` — append-only JSONL, `YYYY-MM.jsonl`, states, sub-status | ✅ confirmed | [tasks.js:1-26](src/core/stores/tasks.js:1); `TASK_STATUSES` at [:25](src/core/stores/tasks.js:25); no cross-project reader exists — every function takes a single `storagePath` |
| 11 | `catalog.js` = Asana + GitHub + Obsidian, WhatsApp coming-soon, no calendar | ✅ confirmed | [catalog.js:19-36](src/core/integrations/catalog.js:19) |
| 12 | `self-memory.js:10` "skimming its own recent sessions" is aspirational | ✅ confirmed | [self-memory.js:10](src/core/agent/self-memory.js:10) — comment exists, no such function anywhere |
| 13 | Four outbound Telegram push paths | ✅ all four exist | `/telegram/notify` [api/telegram.js:303](src/host/daemon/api/telegram.js:303) · tool [send-telegram.js](src/core/agent/tools/handlers/send-telegram.js) · [wakeup.js:6,75](src/host/daemon/wakeup.js:6) · [ask-callbacks.js:54,110](src/core/channels/telegram/ask-callbacks.js:54) |
| 14 | wake-up already implements a 30-min cooldown worth copying | ✅ confirmed | [wakeup.js:6](src/host/daemon/wakeup.js:6) `WAKEUP_COOLDOWN_MS = 30 * 60 * 1000` |
| 15 | Inline keyboards exist for the feedback button | ✅ confirmed | [ask-callbacks.js:54](src/core/channels/telegram/ask-callbacks.js:54) passes `reply_markup` |
| 16 | `shortId()` is the right id primitive | ✅ confirmed | [ids.js:10](src/core/util/ids.js:10); tasks already use it via [tasks.js:41](src/core/stores/tasks.js:41) |
| 17 | `ARTIFACTS_SKIP_SIGNAL` = `"APX_SKIP"` | ✅ confirmed | [artifacts.js:7](src/core/stores/artifacts.js:7); consumed [runner.js:227](src/core/routines/runner.js:227) |
| 18 | Vault two-layer model + tombstones | ✅ confirmed | [parser.js:113-133](src/core/apc/parser.js:113); `VAULT_DIR`, `BUNDLED_VAULT_DIR`, `VAULT_TOMBSTONE_PATH` |
| 19 | No `persona` key in config today — clean namespace | ✅ confirmed | no hit in `src/core/config/`; not in `CREDENTIAL_PATHS` [config/index.js:226-240](src/core/config/index.js:226), so adding it is safe for `writeConfig`'s credential guard |
| 20 | Base prompt ≈ 2.5k tokens (rule 12) | ✅ **measured** | `inspect-channel-prompts.js`: telegram 2486 · cli 2439 · web 2510 · desktop 2698 · routine 2479 |
| 21 | `docs/capabilities/routines.mdx` misdescribes `--skip-prompt-on signal` | ✅ **confirmed, and worse** | see §3.H |
| 22 | Panel is the best living documentation | ✅ agreed | project tabs: Overview, Agents (+`AgentBrainGraph` = the "brain"), Tasks, Routines, Chat, Config, Docs, Files, Integrations, Mcps, Memories, Skills, Structure, Telegram, Vars, Artifacts |

Nothing in `CHANGELOG.md` between 1.67.0 and 1.74.0 touches routines, the prompt builder, or
personas. The specs' 1.74.1 baseline is still valid.

---

## 2. 🔴 Blocking problems — resolve before Phase 2

### A. `assets/` does not ship to npm

`package.json` `files` is `["src/", "skills/", "README.md"]` plus negations. I verified with
`npm pack --dry-run`: the tarball contains **zero** top-level `assets/` entries (the 11
`assets/` hits are all `src/interfaces/web/dist/assets/*`, the built web bundle).

Two consequences:

1. **Spec §3's `assets/personas/<id>/` cannot work.** Phase 4's headline acceptance criterion
   — *"alguien instala APX limpio y corre `apx persona install secretary`"* — would fail for
   every npm user while passing perfectly in this repo. This is the single highest-risk item
   in the whole plan: it works on our machine and only breaks in production.
2. **This is a pre-existing bug, not one we'd introduce.** `BUNDLED_VAULT_DIR` resolves to
   `assets/agent-vault-defaults` ([parser.js:133](src/core/apc/parser.js:133)), which does not
   exist in an npm install either — so `readVaultAgents()` silently returns only the user
   layer for npm users. Worth a separate issue regardless of this project.

**Options** (needs your call): (a) put bundled personas under `src/core/personas/` alongside
`src/core/runtime-skills/`, which already ships and is the closest existing precedent;
(b) add `assets/` to `files` and fix the vault bug in the same PR. I lean (b) for correctness
plus (a) for the personas themselves, but this is a packaging decision, not mine to make
silently.

### B. Vault is a layered read, not copy-at-install — §3 and §4 contradict

Spec §3 says *"reusá **exactamente** el patrón copy-on-write del vault"*. Spec §4 step 4 says
*"Copiar a `~/.apx/personas/<id>/`"*. These are different mechanisms and only one is what the
vault does.

`readVaultAgents()` ([parser.js:162-178](src/core/apc/parser.js:162)) **never copies**. It
reads bundled and user directories at call time into one map, user wins per slug, tombstones
filter. Copy-on-write happens only when the user *edits* — writes always land in the user
layer.

If `install` literally copies bundled → `~/.apx/personas/`, then a user who installs the
bundled secretary is frozen at that version forever: `npm update apx` ships an improved
`PERSONA.md` they never see, because their copy shadows it. That is the opposite of what the
vault does and it will bite on the first persona update.

**Recommendation:** follow the vault for real — resolve bundled ∪ user at read time, write to
the user layer only on `config`/edit, and use a tombstone file for `uninstall` of a bundled
persona. `install` for a *bundled* persona then becomes almost a no-op (validate + write
config defaults); only a *local-path* install actually copies. This also makes §4's
"uninstall preserves what the user edited" fall out for free instead of needing bookkeeping.

### C. `PERSONA.md` blows its declared budget

Measured: 6169 chars ≈ **1533 tokens** (chars/4), against `prompt_budget_tokens: 900`.
That is 1.70×, which trips spec §4 step 3's own hard-fail rule (*"Si supera 1.5×, fallar"*).
**The persona shipped in this spec pack would be rejected by the installer the spec
describes.**

Worse is the systemic cost. Every channel today sits at ~2.4-2.7k tokens and AGENTS.md rule 12
exists specifically to defend that. Adding 1533 tokens takes telegram from 2486 → ~4019, a
**+62% increase on every turn of every channel**, permanently, for anyone with the persona
active. Note this is *additive on top of* the base — the persona does not replace anything.

**Options:** (a) cut `PERSONA.md` to ~900 tokens — the "Channels", "Delegation" and "Never"
sections restate things `channels/*.md` and `action-discipline.md` already say, so this is
achievable without losing the criterion; (b) raise the declared budget to 1600 and accept the
cost consciously; (c) split — a lean always-on core block plus the operational detail moved
into an on-demand `apx-secretary-*` skill, which is exactly the pattern rule 12 prescribes
("operational syntax belongs in on-demand `apx-*` skills").

I recommend **(c)**, falling back to (a). It is the only option that keeps rule 12 honest and
it matches how the codebase already solves this problem.

---

## 3. Wrong, outdated, or imprecise in the specs

**D. `{{persona.name}}` will not render.** Spec §6 suggests heading the block with
`# Role: {{persona.name}}`. `renderPromptTemplate`'s regex is `/\{\{(\w+)\}\}/g`
([prompt-builder.js:87](src/core/agent/prompt-builder.js:87)) — `\w` excludes `.`, so a dotted
variable is left **literally in the prompt**. Spec §8 classifies a visible `{{...}}` as a
high-severity bug, so the spec's own example would violate the spec's own checklist. Use a
flat name (`{{persona_name}}`), or better a fixed literal heading — the good news is
`PERSONA.md` itself only uses flat `\w+` variables and is safe as written.

**E. There is no "neutral fallback" — missing vars render as empty string.**
`renderPromptTemplate` returns `""` for null/undefined/empty
([prompt-builder.js:88-89](src/core/agent/prompt-builder.js:88)). So an unset `owner_name`
produces `"You are 's chief of staff."` — grammatically broken, and it silently passes any
test that only greps for `{{`. §8's "fallback neutro" requirement must be implemented in the
persona **loader** (resolve every schema key to its default, then a neutral literal for
`owner_name`) before calling the renderer. Do not expect the renderer to do it.

**F. "persona" already means something else in this codebase.** Spec §2 cites
[self.js:13](src/core/identity/self.js:13) as evidence the vocabulary is established. The
comment is real, but read the next one: [self.js:23-25](src/core/identity/self.js:23) —
*"Resolve the super-agent's DISPLAY name (the persona shown to users)"*. And AGENTS.md rule 4:
*"'super-agent' is a mode, not a persona name."* In current code **persona = the agent's
display name** (`identity.json.agent_name`), not a behaviour package. The spec is introducing
a second, different meaning for a word already in use two lines apart in the same file.
I still think `persona` is the right product word, but the code needs a defensive comment at
each site and `config.persona` must never be confused with `identity.agent_name`. Flagging so
it is a decision, not an accident.

**G. Minor line drift.** `shouldSkipPrompt` is at
[runner.js:223](src/core/routines/runner.js:223), not 227 (227 is the `signal` branch inside
it). `HANDLERS` at 189 and `renderPromptTemplate` at 86 are exact.

**H. The `docs/` error is bigger than the backlog says.** Backlog line 17 warns that
`capabilities/routines.mdx` describes `--skip-prompt-on signal` badly. It is not imprecise, it
is wrong on two rows ([routines.mdx:95-99](docs/src/content/docs/capabilities/routines.mdx:95)):

- `signal` — doc: *"Skip LLM only on SIGINT/SIGTERM; non-zero exit still runs the LLM."*
  Code: skips when pre-command **stdout contains `APX_SKIP`**. Signals are not involved at all.
- `pre_success` — doc: *"Same effect as `pre_failure` in most cases."*
  Code: `pre_failure` skips when `exitCode !== 0`, `pre_success` skips when `exitCode === 0`
  ([runner.js:228-229](src/core/routines/runner.js:228)). They are exact opposites.

Both EN and ES pages need fixing. Small, and it should ride along with Phase 1 since we are in
that file's neighbourhood.

---

## 4. Not anticipated by the specs

**I. Routines are keyed by `name`, and C1 introduces a second key.** Every mutator addresses
routines by name — `getRoutine` [:91](src/core/stores/routines.js:91), `deleteRoutine`
[:136](src/core/stores/routines.js:136), `setEnabled` [:145](src/core/stores/routines.js:145),
`updateRunState` [:155](src/core/stores/routines.js:155). I grepped every consumer of
`routine.id` in the tree: it is used in **exactly two modules**, `routine-memory.js` and
`runner.js:121-132`. Nothing in the API or web panel reads it.

That makes C1 low-risk, but it exposes two traps the spec does not mention:

- `upsertRoutine` **rebuilds `entry` from scratch on every call** (it does not merge into
  `prev`). The new code must explicitly carry `prev?.id` forward, exactly as it already does
  for `created_at`. Miss this and every edit to a routine silently re-ids it and orphans its
  memory — a regression *caused by* the fix.
- **Rename is undefined behaviour.** Renaming a routine means `findIndex(r => r.name === name)`
  misses, so a *new* record with a *new* id is appended and the old one lingers. The memory
  directory is orphaned. Worth deciding now: either keep `id` stable across rename (needs a
  rename path that addresses by id) or document that renaming resets memory.

**J. "Assign ids on read" is the wrong place to migrate.** Spec §C1 says *"al leer
`routines.json`, si un registro no tiene `id`, asignarlo y persistir"*. `readFile`
([routines.js:13-22](src/core/stores/routines.js:13)) is a pure read called by every code path
— including `getDueRoutines`, which the daemon scheduler polls **every 5 seconds**
(`host/daemon/routines-scheduler.js`). Writing from inside it means write amplification and a
real read-modify-write race between the scheduler and a concurrent CLI edit. Prefer an
explicit `ensureRoutineIds(storagePath)` called once at daemon boot and from `upsertRoutine`,
leaving `readFile` pure.

**K. The "byte-identical vanilla" test has a hidden dependency on `$HOME`.**
`buildSuperAgentSystem` is **synchronous** and calls `readIdentity()` internally
([prompt-builder.js:272-274](src/core/agent/prompt-builder.js:272)), which reads
`~/.apx/identity.json`. Two consequences: (1) `buildPersonaBlock` must also be sync, so the
`PERSONA.md` read has to be `readFileSync` + cached, same as `loadPrompt`; (2) the vanilla
test must set `process.env.HOME` to a temp dir **before importing the module** (AGENTS.md
rule 1) or it will pass or fail depending on whose laptop runs it. `tests/prompt-builder.test.js`
already exists and is the right home for it.

**L. C5 has no usable choke point today.** All four push paths funnel into
[plugins/telegram/index.js:211 `_send()`](src/host/daemon/plugins/telegram/index.js:211) and
then `sendMessage()` ([channels/telegram/api.js:29](src/core/channels/telegram/api.js:29)).
Tempting — but `_send` also carries **solicited replies** to the user, so gating there would
throttle normal conversation. The gate has to sit above it, which means an explicit
`unsolicited: true` (or `nudge: {...}`) threaded from each of the four callers. That is more
invasive than "add a module", and the spec's grep-audit acceptance criterion is exactly right.
Budget real time for C5; it is not a small phase.

**M. Web panel work has three known footguns** (AGENTS.md rules 9, 11, 50): add `/personas` to
`API_PREFIXES` in `api/shared.js` or an authenticated GET gets served as an SPA asset without
auth; add `isKnownSpaRoute` for the new screen; every i18n key in **both** `en.ts` and `es.ts`
or `tsc --noEmit` fails preflight; and the panel must call the same core functions as the CLI,
never a parallel implementation.

**N. Operational note:** the running daemon reports **v1.73.1** while the repo is 1.74.0 — the
global `apx` symlinks to this checkout, so it needs `apx restart` after changes land, and the
panel I toured is one version behind the tree.

**O. Secrets hygiene:** the live Routines panel shows routine prompts containing a plaintext
API bearer token. Per AGENTS.md rule 3 I have not copied any of it into this document, and no
panel or CLI output should be pasted into commits, issues or test fixtures during this work.

---

## 5. Proposed order

I agree with the backlog's sequence, including — emphatically — **C5 before C4**. The reasoning
in KICKOFF is correct and I would not invert them.

Three changes:

1. **Insert a Phase 0.5 (decisions, no code):** settle A (where bundled personas live / does
   `assets/` ship), B (layered vs copied), and C (prompt budget). All three change Phase 2's
   design rather than its implementation, and discovering them mid-PR means rework.
2. **Fold the `docs/routines.mdx` correction into Phase 1.** Same file neighbourhood, five
   minutes, and rule 6 requires docs to move with behaviour anyway.
3. **Move C2 (cross-project tasks) ahead of Phase 2** — or at least accept it may need to.
   Phase 4's anchors are the first real consumer of the persona, and they cannot be written
   without cross-project reads. Phase 2 can technically ship without C2, so I would keep the
   stated order and only reorder if Phase 2 slips; noting it so it is a conscious choice.

On C2's performance clause: today's `listTasks` folds the whole JSONL history per project on
every call ([tasks.js:171](src/core/stores/tasks.js:171)). The spec says measure before
caching, which is right — I would add that the natural cache key is `(storagePath, mtime of
tasks dir)`, and the daemon is the only process that should hold it.

---

## 6. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `assets/` not shipping — works in dev, breaks for every npm user | 🔴 high | Resolve A before Phase 2; add a test that asserts the bundled-persona dir resolves from a packed install |
| Vanilla prompt regression (the invariant) | 🔴 high | The §9 test 1, written **first**, with `HOME` pinned to a temp dir; snapshot the current output per channel before touching the builder |
| C1 fix silently re-ids routines on edit | 🟠 medium | Carry `prev?.id`; test that `upsertRoutine` twice keeps the same id and the same memory dir |
| Migration-on-read racing the 5s scheduler | 🟠 medium | Explicit `ensureRoutineIds()` at boot; keep `readFile` pure (finding J) |
| Prompt budget regression on all channels | 🟠 medium | Decide C now; add `inspect-channel-prompts.js` output to the Phase 2 PR description as a before/after |
| C5 gate throttling solicited replies | 🟠 medium | Gate above `_send`, never inside it; explicit `unsolicited` flag + grep audit (finding L) |
| Persona routines colliding with user routines by name | 🟡 low | `origin: "persona:<id>"` as specced, plus a name prefix, since `name` is the real PK (finding I) |
| `/personas` route served as SPA asset without auth | 🟡 low | `API_PREFIXES` (AGENTS.md rule 9) |

---

## 7. Could not verify

- **`spec/` directory** — the backlog notes it does not exist despite AGENTS.md referencing it.
  Confirmed absent; [runner.js:105](src/core/routines/runner.js:105) also cites
  `spec/backlog/01-routine-output-coherence.md`, which is a dead reference in a code comment.
- **Whether `apx routine memory show <name>` currently returns wrong data in practice** — I did
  not execute it against the live daemon, since doing so writes to real user storage. The code
  path is unambiguous (finding 6) but the empirical check belongs in Phase 1's test, not here.
- **`optional_integrations` / `requires.capabilities` semantics** — there is no existing
  capability registry in the codebase to check against. These fields would be inventing a new
  concept, not describing an existing one. Fine, but they are greenfield: nothing to verify.

---

## 8. Decisions taken (resolved after review)

Recorded here because they correct the specs, and a correction that lives only in a chat
log is a correction that gets undone in six months.

**Naming — the subsystem is `profile`, not `persona`.** Finding F is resolved by renaming
the new thing rather than the old one. `persona` keeps its existing meaning (the
super-agent's visible name, `identity.json.agent_name`, AGENTS.md rule 4). An **agent
profile** is the installable package. Where the bare word could be read as a configuration
profile, write "agent profile". Noted in AGENTS.md rule 4.

**A — bundled packages live in `src/core/profiles/bundled/`.** `assets/` does not ship to
npm. The pre-existing `assets/agent-vault-defaults` bug is real but **degrades rather than
throwing**: `readVaultDirRaw` (parser.js:137) returns `[]` for a missing directory, so an
npm user silently gets only their own vault agents, and every consumer handles the empty
case. Medium severity, separate PR, not a blocker for this work. How many npm installs are
affected is not knowable from here — there is no telemetry and no way to distinguish an npm
install from a repo checkout.

**B — layered read, and only a local path copies.** Resolving bundled ∪ user at read time
(the vault's model) is what keeps a bundled package improvable by `npm update`. The
refinement on top of the original decision: a package installed from a **local path** *is*
copied into `~/.apx/profiles/`, because that source lives outside APX and can move or
vanish; a **bundled** package is not, because it cannot. Two consequences are contractual:
user settings in `config.profile` survive a bundled version bump untouched, and a new
schema field added by an update is filled from its default silently — the user learns about
it from `apx profile doctor`, never from a prompt.

**C — the prompt budget is split three ways, not two.** The original proposal (lean core
block + on-demand skill) was wrong in a specific way: an on-demand skill loads *at the
model's discretion*, and "should I interrupt?" is a decision the model may not know it is
about to take. A guardrail cannot depend on the guarded party fetching it. So:

1. **Core block** — always on, hard ceiling ~600 tokens. Identity, condensed
   responsibilities, capture, never-invent-state, tone, one line each on delegation and
   permissions.
2. **Channel overlay** — `profiles/<id>/channels/<ch>.md`, rendered and appended after the
   core channel file, only on that surface. The interruption gates, signal catalogue,
   budget and rejection-learning go in `channels/routine.md`: loaded deterministically when
   a routine fires, free everywhere else. Verified feasible against
   `buildChannelContextBlock` (prompt-builder.js:97-101, called at :292) — implemented as a
   sibling function, that one is untouched.
3. **On-demand skill** — genuinely operational procedures (how to assemble a briefing, how
   to capture to tasks, how to do project re-entry). This is what rule 12 means by
   on-demand.

Channel overlays are a **core capability**, available to any profile.

**D/E — the install gate is the defence; the renderer is only the net.** Stripping orphan
`{{…}}` at render time stays, but installation now **fails, naming the variable**, when a
template uses one that cannot resolve: a non-`\w+` placeholder, a name that is neither a
built-in nor a schema property, or a schema property declared without a default. A visible
`{{…}}` or a "You are 's chief of staff" in production is severity-high, and the point is
to make it unreachable rather than survivable.

**L — the C5 gate does not go in the transport.** Confirmed as a spec correction: a
chokepoint in `_send` would throttle solicited replies too. The gate belongs in the four
callers, with an explicit `unsolicited` flag. The Phase 6 PR must carry the grep audit
proving all four pass through it.

**Not adopted:** nothing. Every finding above was reviewed and either accepted or corrected
into something better.
