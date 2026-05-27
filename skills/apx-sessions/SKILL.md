---
name: apx-sessions
description: "APX session management across engines (apx, claude, codex). Use when: listing sessions of one or every engine for a project, resuming a session by id without remembering which engine owns it, summarizing a Claude/Codex/APX transcript, pulling a full transcript by id (useful when you want to read another tool's session from inside Claude), spawning the native CLI to continue a session (`claude --resume`, `codex resume`), or seeding a brand-new APX session with the summary of an old one. Triggers on: 'apx session resume', 'apx session get', 'apx sessions list', 'continue codex session', 'resume claude session', 'summarize session', 'get session transcript', 'continue session in apx', 'qué sesiones hay', 'traer sesión de codex', 'leer sesión de claude'. Do NOT activate for generic agent orchestration or `apx run` — that belongs to the parent `apx` skill."
---

# APX Sessions — cross-engine resume, summary, and continuation

APX treats every supported engine (apx, claude, codex, antigravity) as a session store. The commands in this skill let you list, read, summarize, and continue sessions **without caring which engine owns them**.

Engine storage locations APX scans:

| Engine    | Where APX looks                                           |
|-----------|-----------------------------------------------------------|
| apx       | `~/.apx/projects/<apx_id>/agents/<slug>/sessions/*.md`    |
| claude    | `~/.claude/projects/<encoded-cwd>/<id>.jsonl`             |
| codex     | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`            |
| antigravity | detected only — listing not implemented yet              |

Engines not installed on the machine are silently skipped. Detected-but-empty engines show `(sin nada)`.

---

## Listing sessions

```bash
# Every detected engine, every known project — broadest view
apx sessions list

# Every engine, scoped to one directory (no need for it to be a registered APX project)
apx sessions list --dir /path/to/repo
apx sessions list --project iacrmar          # uses a registered APX project's path

# One engine, all projects
apx sessions list --engine claude
apx sessions list --engine codex

# One engine, one project
apx sessions list --engine claude --project iacrmar
apx sessions list --engine codex  --dir /path/to/repo --limit 10
```

Output format per engine: `DATE | SESSION ID | TITLE`, newest first, plus the exact native-CLI resume command at the bottom.

When no `--engine` is passed, output is grouped by engine with `══ <Engine> ══` headers. Empty engines print `(sin nada)`; un-installed engines are not listed at all.

---

## Resuming a session by id (the headline command)

```bash
apx session resume <id>
```

What it does, in order:

1. Searches every detected engine for `<id>` (apx → claude → codex).
2. **One match** → prints metadata: engine, file path, cwd, title.
3. **Zero matches** → exits non-zero with `session "<id>" not found in any detected engine`.
4. **Multiple matches (collision)** → prints all of them and exits with code 2, telling you to re-run with `--engine <id>`.

Then it applies any of the following flags:

| Flag | Effect |
|------|--------|
| `--engine <apx\|claude\|codex>` | Restrict the search to one engine (skip auto-detection). |
| `--tail N[k\|m]` | Print last N bytes of the transcript (e.g. `--tail 32k`). No daemon required. |
| `--full` / `--body` | Dump the entire transcript. No daemon required. |
| `--summary` | Send the tail to the APX super-agent and print a 4-bullet summary. **Requires daemon + `super_agent.enabled`.** |
| `--continue` | Spawn the engine's native CLI in resume mode (`claude --resume <id>`, `codex resume <id>`) in the recorded cwd. |
| `--into apx[:slug]` | Create a brand-new APX session whose body is the summary of `<id>`. Frontmatter records `parent_session: <engine>:<id>` for lineage. Default slug = the session's original APX agent if any, else the first agent in `AGENTS.md`. |
| `--project <name\|id\|path>` | Used only for `--summary` on apx-native sessions (picks the daemon project). |

### Common recipes

```bash
# "I have a Codex session id, give me a summary in apx"
apx session resume 019abc... --summary

# "I want to keep working on that Codex thread, but in APX with the reviewer agent"
apx session resume 019abc... --summary --into apx:reviewer

# "Just dump the full transcript so I can grep it"
apx session resume 019abc... --full | rg "TODO"

# "Re-open in the native CLI, interactively"
apx session resume 019abc... --continue

# "I know it's a Claude session, skip auto-detect"
apx session resume 2e3c840b-... --engine claude --tail 16k
```

---

## Reading a session's content (`apx session get`)

`apx session get` is the "fetch and read" command. It has two modes:

### Default mode — local APC project sessions

```bash
apx session get <id>             # metadata of the local APC session
apx session get <id> --body      # full markdown body
apx session get <id> --json      # machine-readable metadata
```

### Engine mode — read any engine's session by id

```bash
apx session get <id> --engine claude --full       # full Claude JSONL
apx session get <id> --engine codex  --tail 16k   # last 16 KB of a Codex rollout
apx session get <id> --any --full                  # search every engine, error on collision
apx session get <id> --engine claude --json        # JSON metadata only
```

**This is the command you want when you're inside Claude and need to ingest a Codex/Claude session as context.** Pipe `--full` into a file or directly into your prompt.

```bash
# Pull a Codex session into context for the current Claude session
apx session get 019abc... --engine codex --full > /tmp/prev.jsonl
```

---

## Daemon vs. no daemon

| Capability | Daemon required? |
|------------|------------------|
| `apx sessions list ...` | ❌ no |
| `apx session get ...` (any mode) | ❌ no |
| `apx session resume <id>` (metadata only) | ❌ no |
| `apx session resume <id> --tail / --full` | ❌ no |
| `apx session resume <id> --continue` | ❌ no |
| `apx session resume <id> --summary` | ✅ yes (daemon + `super_agent.enabled` in `~/.apx/config.json`) |
| `apx session resume <id> --into apx[:slug]` | ⚠️ daemon needed only to compute the summary it embeds; without it, the new session is created with an empty summary block |

If the daemon is down, `apx` auto-starts it when needed.

---

## Native APX session commands (legacy / still useful)

These manage APX-native sessions (the `.md` files in `~/.apx/projects/.../sessions/`). They do **not** see Claude/Codex sessions.

```bash
apx session new <slug> --title "Investigate bug X"
apx session list                       # all agents in the current APC project
apx session list <slug>                # one agent
apx session update <id> --status "in progress"
apx session close <id> --result "Fixed in PR #42"
apx session check                      # exit 1 if any APX session is still open
apx session close-stale                # auto-close sessions older than 1h
apx session compact <slug>             # summarize a conversation durable to disk
```

These live next to the new cross-engine commands above; they don't replace each other.

---

## Disambiguating collisions

If two engines happen to use the same id string for different sessions:

```
$ apx session resume abc123
⚠️  session id "abc123" exists in multiple engines:
  - claude  /Users/.../-Volumes-work-repo/abc123.jsonl  (cwd: /Volumes/work/repo)
  - codex   /Users/.../sessions/2026/05/27/rollout-2026-05-27T10-00-00-abc123.jsonl  (cwd: /Volumes/work/repo)
→ re-run with --engine <id> to pick one (apx | claude | codex)
```

Pick one with `--engine claude` or `--engine codex` and run again.

---

## Tips for callers (LLMs)

1. **Don't ask the user which engine.** Always try the auto-detect first: `apx session resume <id>`. If the CLI prints a collision message, *then* re-run with `--engine`.
2. **Prefer `--tail N` over `--full`** when feeding into another model — JSONL is verbose, the tail is dense.
3. **`--into apx:slug` is the bridge** between an external runtime's session and an APX agent. Use it when the user says "continuamos esto en apx con el agente reviewer".
4. **Don't invent ids.** Always discover them via `apx sessions list` (or `--engine X --dir Y` to narrow down).
5. **`apx session get --any --full`** is the simplest way to import an arbitrary engine session into your context, with no daemon dependency.

---

## Quick reference card

```bash
# Discovery
apx sessions list                                  # all engines, all projects
apx sessions list --project <name>                 # all engines, one project
apx sessions list --engine <id> --dir <path>       # one engine, one dir

# Read
apx session get <id>                               # local APC session metadata
apx session get <id> --engine <id> --full          # any engine, full transcript
apx session get <id> --any --tail 32k              # any engine, last 32 KB

# Resume / continue
apx session resume <id>                            # auto-detect engine, show metadata
apx session resume <id> --summary                  # add super-agent summary
apx session resume <id> --continue                 # spawn native CLI to keep working
apx session resume <id> --into apx:<slug>          # seed a new APX session with the summary
```
