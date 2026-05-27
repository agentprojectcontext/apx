# Agents — APX repo

> This file documents the conventions for any AI agent (Claude Code, Cursor, Codex, etc.) working **inside this repo** (the APX CLI + daemon source).
>
> It is intentionally a real `AGENTS.md` so the repo also serves as a self-test of its own protocol.

---

## Project rules

### 1. Always run tests before committing

Every change to `src/daemon/` or `src/cli/` MUST be accompanied by:

1. The relevant test(s) under `tests/`.
2. A clean run of:
   ```bash
   npm test
   ```
3. The smoke test that boots the daemon and pings `/health`:
   ```bash
   npm run smoke
   ```

If the change can't be unit-tested (e.g. external API call, headless CLI spawn), add a smoke test that exercises the path with a mocked engine.

### 2. One spec note per substantial change

Anything that adds or changes user-visible behavior gets a paragraph in the relevant `docs/` file in the **same commit**:

- New CLI command → APC docs `src/pages/docs/reference/apx-cli.mdx`
- New daemon endpoint or behavior → APC docs `src/pages/docs/reference/apx-daemon.mdx`
- Schema change, new on-disk file/directory → APC docs `src/pages/docs/specification/`
- Skill/agent prompt change → `src/core/apx-skill.md` and `src/core/apc-context-skill.md`

Don't ship a feature whose only documentation is the commit message.

### 3. The filesystem is the source of truth

Project context lives in `.apc/`. Runtime state lives in `~/.apx/`. If you add a new type of persistent state, make the boundary explicit.

Runtime sessions, conversations, messages, caches, and provider transcripts MUST NOT be placed inside `.apc/`.

### 4. Skill files have two sources of truth — keep them in sync

The canonical skill bodies live in:
- `src/core/apx-skill.md` — APX CLI skill body
- `src/core/apc-context-skill.md` — APC context skill body

The frontmatter `description` strings are assembled in `src/core/scaffold.js` (`buildSkillMd`, `buildApcContextSkillMd`). After any change to skill content or description, reinstall:

```bash
apx skills add --global
```

### 5. Routines live in APX home storage, not inside the project

Routines are stored in `~/.apx/projects/{apxId}/routines.json` (the project's `storagePath`), **never** inside the project directory or `.apc/`.

When creating routines via `apx routine add`, always pass `--project <id|name|path>` so the routine is associated with the correct project. Without `--project`, the default project (id=0) is used, which is a shared scratch space — **not** a real user project.

```bash
# Correct: pin to a specific project
apx routine add weather-bariloche --kind super_agent --schedule "0 8 * * *" --project agent-project-context --prompt "..."

# Wrong: creates routine in default project (id=0)
apx routine add weather-bariloche --kind super_agent --schedule "0 8 * * *" --prompt "..."
```

Use `apx project list` to see registered project IDs and names before creating routines.

### 6. Self-run / Super-agent identity

When acting as APX itself (self-run, "vos mismo", or default mode), always use `apx` as the agent identity for sessions and logs. Do **not** force the selection of a project agent from `AGENTS.md` unless the user explicitly names one. Tool calls like `call_runtime` should omit the `agent` parameter in this mode.

### 7. "Super-agent" terminology

`super-agent` is **not** a persona name — it is the *mode* in which the APX default agent runs (the daemon-level tool-using loop that handles requests when no project agent is named). It appears in:

- Code paths: `src/core/agent/run-agent.js`, `src/host/daemon/super-agent.js`, `src/host/daemon/api/super-agent.js`
- HTTP routes: `/projects/:pid/super-agent/chat[/stream]`
- Config keys: `~/.apx/config.json → super_agent.{enabled, model, system, model_fallback}`
- Channel meta and routine kinds: `kind: "super_agent"`
- Prompts: `src/core/agent/prompts/super-agent-base.md`

The user-facing display name of this agent comes from `~/.apx/identity.json` (the "agent name"). When writing user-visible copy (Telegram, overlay bubbles, CLI output, error messages), refer to the agent by that identity name — never as "super-agent". When writing internal documentation or code comments, "super-agent" is the correct term for the mode.

If you are an LLM reading this: treat any user reference to "the super-agent" as a reference to **you in default-APX mode**. Do not look for an agent literally named `super-agent`; there isn't one.

---

## Agents in this project

> Roles, not personas. These describe the kinds of work an AI agent might do inside this repo.

## maintainer
- **Role**: Repo maintainer
- **Model**: claude-sonnet-4-6
- **Skills**: review, test, doc-sync
- **Description**: Reviews PRs, ensures the rules above hold, refuses commits that touch behavior without tests or doc updates.

## protocol-author
- **Role**: Spec writer
- **Model**: claude-opus-4-7
- **Skills**: doc-sync, spec-design
- **Description**: Owns the SPEC documents. Any change to APC spec, daemon API surface, or CLI grammar should go through review here.

---

## Reading order for a new contributor

1. [`README.md`](README.md) — what APC/APX is.
2. APC specification pages in `../apc/src/pages/docs/specification/`.
3. APX daemon reference in `../apc/src/pages/docs/reference/apx-daemon.mdx`.
4. APX CLI reference in `../apc/src/pages/docs/reference/apx-cli.mdx`.
5. This file — house rules.

---

## Out of scope here

This `AGENTS.md` is for the APX source repo. Project-level `AGENTS.md` files in user projects follow the same format but contain their own rules and agent definitions.
