---
name: apx-profile
description: Agent profiles — installable lines of work for the super-agent (secretary, project manager, analyst, tutor). Load when the user wants to install, activate, configure, diagnose or remove one, or asks why the agent behaves the way it does. Triggers: 'install a profile', 'apx profile', 'what profiles are there', 'activate the secretary', 'go back to vanilla', 'change my agent's schedule', 'why does it message me'.
---

# apx-profile

A **profile** is an installable package that gives the super-agent a line of work: a
prompt block, its own routines, and the white-label settings the owner fills in. With no
profile active APX is *vanilla* — the system prompt is byte-identical to a clean install.

Three words that are easy to confuse. Keep them apart:

| Term | What it is | Where it lives |
|---|---|---|
| **profile** | an installable line of work (this skill) | `~/.apx/profiles/`, `config.profile` |
| **persona** | the super-agent's visible NAME | `~/.apx/identity.json` → `agent_name` |
| project config | per-project overrides | `.apc/config.json` |

Installing and activating are **different operations**. `install` validates a package and
makes it reachable; `use` is the moment behaviour changes.

## Concrete CLI calls

```bash
# Discover
apx profile list                      # everything available, and which is active
apx profile show secretary            # settings, token cost, where it came from
apx profile show secretary --preview  # ...plus the rendered prompt block

# Install and activate
apx profile install secretary         # a bundled id
apx profile install ./my-profile      # a local package directory
apx profile use secretary             # activates + installs its routines
apx profile use tutor --force         # replace whatever is active

# Configure — this is where white-label happens
apx profile config                                  # show current settings
apx profile config --set day_open_at="30 8 * * 1-5"
apx profile config --set nudge_budget_per_day=3 --set quiet_hours=22:00-07:30
apx profile config --interactive                    # walk the whole schema

# Health and removal
apx profile doctor                    # what's missing for it to do its job
apx profile off                       # back to vanilla
apx profile uninstall secretary
```

## What each command actually does

- **`install`** validates the manifest, the schema and every template, then seeds the
  settings with the schema defaults. It does **not** activate. A **local path** is copied
  into `~/.apx/profiles/`; a **bundled** package is not — it is read in place so a later
  `npm update` improves it instead of being shadowed by a stale copy.
- **`use`** writes `config.profile.active`, reloads the prompt, and installs the package's
  routines (named `<profile-id>-<routine>`, marked `origin: "profile:<id>"`).
- **`off`** sets `active: null` and **disables** those routines. It deletes nothing —
  settings, tasks, commitments and memory all survive, so `use` again restores everything.
- **`config`** validates against the schema and **really reschedules**: changing an opening
  time moves the cron, it doesn't just edit JSON.
- **`uninstall`** removes the package and the routines it installed, but **keeps any routine
  the user edited** and never touches one the user wrote. A bundled package can't be
  deleted, so it gets a tombstone and can be reinstalled any time.

## Settings are per profile

`config.profile.configs[<id>]` holds each profile's own settings; `config.profile.config`
mirrors the active one. Switching A → B → A gives A its settings back rather than handing
it B's.

## When the user asks "why did it message me?"

Read the active profile's prompt block — `apx profile show <id> --preview` — and its
settings. Interruption budgets, quiet hours and staleness thresholds are all profile
settings, not core behaviour. If the answer is "it shouldn't have", the fix is usually
`apx profile config`, not a code change.

## Package layout

```
<id>/
  profile.json            # manifest: id, name, version, requires, prompt_budget_tokens
  PROFILE.md              # the always-on prompt block (template)
  PROFILE.es.md           # optional translations: PROFILE.<lang>.md
  config.schema.json      # the white-label settings, every one with a default
  channels/<ch>.md        # optional per-channel overlay, appended after the core file
  routines/*.json         # routines it installs
  agents/*.md             # specialists it adds to the vault
  skills/<slug>/SKILL.md  # its own operational procedures
```

**Template rules, enforced at install time** (installation fails, naming the variable):

- Only flat `{{single_word}}` names. `{{profile.name}}` cannot be substituted and is rejected.
- Every variable must resolve: a built-in (`owner_name`, `agent_name`, `owner_context`,
  `profile_name`) or a schema property **with a default**. A property declared without a
  default is rejected, because it would silently render as an empty string.

## Channel overlays

`channels/<ch>.md` is rendered and appended after the core `channels/<ch>.md`, only on that
surface. Use it for judgement that must load deterministically where a decision is taken —
the rules for speaking unprompted belong in `channels/routine.md`, not in an on-demand
skill, because "should I interrupt?" is a decision the model may not know it is about to
take. Costs nothing on the channels that don't need it.

## The prompt budget is real

The block ships on **every turn of every channel**, on top of a ~2.5k-token base. A
package declares `prompt_budget_tokens`; exceeding it warns, exceeding 1.5× fails to
install. Check the real number with `apx profile show <id>` or
`node scripts/inspect-channel-prompts.js`.

## HTTP

`GET /profiles` · `GET /profiles/:id` (includes `preview`) · `GET /profiles/doctor` ·
`POST /profiles/install` · `POST /profiles/use` · `POST /profiles/off` ·
`PATCH /profiles/config` · `DELETE /profiles/:id`

## Gotchas

- **`install` does not activate.** The most common confusion. Follow it with `use`.
- **One profile at a time.** Activating a second needs `--force`.
- **`off` is not `uninstall`.** `off` is reversible and keeps everything.
- **The vanilla invariant is load-bearing.** With no profile active the prompt must stay
  byte-identical. If a change would alter that, it's a bug, not a feature.
