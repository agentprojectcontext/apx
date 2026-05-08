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

- New CLI command → `docs/APX-CLI.md`
- New daemon endpoint or behavior → `docs/APX-DAEMON.md`
- Schema change, new on-disk file/directory → `docs/APC-SPEC.md`
- Skill/agent prompt change → `docs/APX-SKILL.md`

Don't ship a feature whose only documentation is the commit message.

### 3. The filesystem is the source of truth

All state lives in `.apc/` (project-scoped) or `~/.apx/` (global vault). There is no database. If you add a new type of persistent state, it must be a file on disk — markdown or JSON. Never introduce a SQLite dependency or any in-memory-only store for operator-visible data.

Runtime state (memory, sessions) MUST NOT be placed inside `.apc/` at the project level unless it belongs to the committed project definition. Agent sessions and memory live in `.apc/agents/<slug>/`.

### 4. Skill files have two sources of truth — keep them in sync

The canonical skill bodies live in:
- `src/core/apx-skill.md` — APX CLI skill body
- `src/core/apc-context-skill.md` — APC context skill body

The frontmatter `description` strings are assembled in `src/core/scaffold.js` (`buildSkillMd`, `buildApcContextSkillMd`). After any change to skill content or description, reinstall:

```bash
apx skills add --global
```

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
2. [`docs/APC-SPEC.md`](docs/APC-SPEC.md) — the protocol on disk.
3. [`docs/APX-DAEMON.md`](docs/APX-DAEMON.md) — the daemon design + REST API.
4. [`docs/APX-CLI.md`](docs/APX-CLI.md) — every `apx` command.
5. This file — house rules.

---

## Out of scope here

This `AGENTS.md` is for the APX source repo. Project-level `AGENTS.md` files in user projects follow the same format but contain their own rules and agent definitions.
