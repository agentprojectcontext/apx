# CLAUDE.md

**Read [`AGENTS.md`](AGENTS.md) before touching this repo.** It is the contract for
working on apx: glossary, repo layout, project rules, and the recipes for adding a
route, a CLI command, an engine or a web screen. This file exists only so tools
that look for `CLAUDE.md` are pointed at it — `AGENTS.md` is the single source of
truth, and nothing here should grow into a second copy of it.

The four steps below are repeated here because skipping them is the most common
way work on apx goes wrong, and an agent that never opens `AGENTS.md` still needs
them. Everything else lives there.

## The dev loop — skip a step and your test is a lie

1. **The daemon runs from the MAIN checkout, never a worktree.** A change
   committed only on a worktree branch is invisible to the running daemon, no
   matter how often you restart it. Confirm with
   `ps -o command= -p "$(pgrep -f 'src/host/daemon/index.js' | head -1)"`.
2. **Restart after EVERY code change, BEFORE testing by hand:** `apx restart`
   (daemon + desktop). The daemon serves the JS it booted with, so without this
   you are testing the previous version.
3. **Verify it took:** `curl -s 127.0.0.1:7430/api/health` (uptime back near
   zero), `apx daemon logs --tail 30` (clean boot), and then exercise the path
   you actually changed — `apx exec "…"` for the agent/tool loop, the route for
   an API change. A booted daemon is not evidence your change works.
4. **Do not report "done" until step 3 passed.** Say what you ran and what it
   returned; if you could not verify, say so plainly.

Exceptions are data, not code: files read on demand (skills, profile packages)
and `~/.apx/config.json`, which `POST /api/admin/reload` re-reads.

See **"The dev loop"** in `AGENTS.md` for the full version, and rule 17 for where
it sits among the project rules.
