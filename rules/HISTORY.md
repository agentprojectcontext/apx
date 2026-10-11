# History

The long *why* behind rules the code enforces: domain rules, provider or library
quirks, fixes and workarounds. Not an ADR (choices between alternatives go to
[`decisions/`](decisions/)), not a changelog, not a system map.

Add an entry only when the code alone does not show the reason and someone
could undo it by "simplifying". Group entries by area; each has a stable anchor
and three fields:

```markdown
## Area

<a id="short-slug"></a>
### One-line rule title
**Rule:** what must stay true.
**Why:** what broke, or would break, without it.
**Where:** the files and tests that enforce it.
```

Every place listed in **Where** carries a one-line comment ending in
`See rules/HISTORY.md#<anchor>`. No personal data, machine-local paths or
real quotes (rule 3).

## Runtimes

<a id="codex-linked-worktree"></a>
### Codex gets a linked worktree's git metadata, not the shared `.git` root
**Rule:** in code mode, when the run's cwd is a linked worktree (git dir ≠
common dir), codex gets `--add-dir` for exactly that worktree's git dir and the
common dir's `objects`, `refs` and `logs`; a resumed turn names the same dirs
through `-c sandbox_workspace_write.writable_roots`. Nothing for a main
checkout, a non-repo or a chat.
**Why:** `workspace-write` keeps `.git` read-only, and a linked worktree's
index, HEAD and FETCH_HEAD live in `<common>/worktrees/<name>`, outside cwd, so
fetch, add and commit all failed with EPERM. Granting the whole common dir
would also open its `config` and `hooks`, where a written line runs code
outside the sandbox the next time anyone uses git there, plus every other
worktree's metadata. `exec resume` takes no `--add-dir` and does not keep the
first turn's roots; on that turn the `-c` replaces any `writable_roots` set in
the user's codex config. What stays failing, by choice: anything that locks a file
in the common dir's root — `config.lock` (setting an upstream) and
`packed-refs.lock` (deleting a branch; auto-maintenance prints it too, with
exit 0). The shared `refs` are one directory, so the agent can also move other
branches, `main` included.
**Where:** `src/core/runtimes/codex.js` (`linkedWorktreeWritableDirs`),
`tests/runtimes.test.js`.
