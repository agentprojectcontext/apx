# Agents — APC repo

> This file documents the conventions for any AI agent (Claude Code, Cursor, Codex, etc.) working **inside this repo** (the APC protocol + APX daemon source).
>
> It is intentionally a real `AGENTS.md` so the repo also serves as a self-test of its own protocol.

---

## Project rules

### 1. Always run tests before committing

Every change to `daemon/` or `cli/` MUST be accompanied by:

1. The relevant test(s) under `daemon/tests/` or `cli/tests/`.
2. A clean run of:
   ```bash
   cd daemon && npm test
   cd cli && npm test   # if cli has its own suite
   ```
3. The smoke test that boots the daemon and pings `/health`:
   ```bash
   cd daemon && npm run smoke
   ```

If the change can't be unit-tested (e.g. external API call, headless CLI spawn), add a smoke test that exercises the path with a mocked engine or a local Ollama model that's almost certainly available.

### 2. One spec note per substantial change

Anything that adds or changes user-visible behavior gets a paragraph in the relevant `docs/` file in the **same commit**:

- New CLI command → `docs/APX-CLI.md`
- New daemon endpoint or behavior → `docs/APX-DAEMON.md`
- Schema change, new on-disk file/directory → `docs/APC-SPEC.md`
- Skill/agent prompt change → `docs/APX-SKILL.md`

Don't ship a feature whose only documentation is the commit message.

### 3. Never lose user data on `project.db` wipe

The `.apc/project.db` SQLite file is **a regenerable cache**. Anything that lives only in SQL must have a filesystem source-of-truth (`.apc/agents/<slug>/...`, `.apc/messages/<day>.md`, `.apc/mcps.json`, etc.) and `rebuildFromFilesystem` must replay it. If you add a new table that holds operator-visible state, you must also add its FS persistence in the same commit.

### 4. The filesystem always wins

If a SQL row and a markdown file disagree, the file is right. `apx project rebuild` exists to enforce this. Never make the daemon write to SQL without also writing to disk for any human-meaningful state.

---

## Agents in this project (the meta-agents that work on APC itself)

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
6. [`examples/my-first-project/`](examples/my-first-project/) — a working project as a reference.

---

## Out of scope here

This `AGENTS.md` is for the APC source repo. The `examples/my-first-project/AGENTS.md` is a different file — a *user-style* AGENTS.md that demonstrates how the protocol looks when consumed.
