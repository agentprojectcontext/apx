---
name: apx-sessions
description: "Cross-engine session ops (apx, claude, codex, antigravity): find by title, list, get transcript, summarize, ask, resume, continue. Triggers: 'apx session find/ask/summary/resume/get', 'find/resume/summarize session', 'get session transcript', 'continue session in apx'. Not for `apx run` orchestration (use apx skill)."
---

# APX Sessions — cross-engine resume, summary, continuation

APX treats every supported engine as a session store. These commands list, read, summarize, and continue sessions **without caring which engine owns them**.

Storage locations APX scans:

| Engine    | Where                                                     |
|-----------|-----------------------------------------------------------|
| apx       | `~/.apx/projects/<apx_id>/agents/<slug>/sessions/*.md`    |
| claude    | `~/.claude/projects/<encoded-cwd>/<id>.jsonl`             |
| codex     | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`            |
| antigravity | detected only — listing not implemented yet              |

Uninstalled engines are skipped silently. Detected-but-empty engines print `(sin nada)`.

---

## Discovery flow (read first)

You start with a vague title, not an id. Do **not** `apx sessions list | grep`. The flow:

```bash
# 1. Title → id (cross-engine, newest first)
apx session find "improve web UI"

# 2. Gist
apx session summary <id>

# 3. Specifics
apx session ask <id> "what sidebar changes were left pending?"
```

`find` prints a "Next:" block with `summary`/`ask`/`resume` pre-filled with the top hit's id. **If tempted to grep session lists, use `find` instead.**

---

## Finding sessions (`apx session find`)

```bash
apx session find "<text>"                      # titles across every engine
apx session find "<text>" --deep               # also greps transcript content
apx session find "<text>" --engine codex       # restrict to one engine
apx session find "<text>" --dir /path/to/repo  # scope (reaches unregistered Claude projects)
apx session find "<text>" --limit 10 --json
```

Default is title-only (fast, indexed). `--deep` reads each candidate transcript off disk; combine with `--engine`/`--dir` to scope. Output rows: `DATE | ENGINE | SESSION ID | TITLE`, newest first, plus ready-to-run `summary`/`ask`/`resume` commands.

**Coverage caveat:** an engine is enumerated only when APX can resolve a project cwd. Codex always records it; APX uses registered projects; **Claude only lists folders mapping to a registered APX project** (encoded folder names are lossy). If a Claude session is missing, scope with `--dir <path>`.

---

## Summarize / Ask

```bash
apx session summary <id>                  # auto-detect, LLM summary
apx session summary <id> --engine claude
apx session summary <id> --max-chunks 8   # bound cost on a huge transcript

apx session ask <id> "what did we decide about the sidebar?"
apx session ask <id> "what files were changed?" --max-chunks 30
```

`summary` is the alias for `apx session resume <id> --summary`: resolves engine, prints a 4-bullet summary plus next steps. `ask` is RAG-lite Q&A: small transcripts answer in one shot; large ones are **map-reduced** (each ~48 KB part mined for relevant notes, final pass synthesizes). Both **require the daemon + `super_agent.enabled`**.

Limits of `ask`: binary noise (base64 images) is stripped before chunking. Coverage capped at `--max-chunks` (default 20 ≈ 960 KB) — bigger transcripts print a truncation warning; raise `--max-chunks` for full coverage at the cost of more sequential model calls. Speed scales with size (seconds to a couple of minutes). Quality depends on `super_agent.model` — cheap thinking models (e.g. gemini-2.5-flash) can return thin answers.

---

## Listing sessions

```bash
apx sessions list                                       # all engines, all projects
apx sessions list --dir /path/to/repo                   # all engines, one dir (no registration needed)
apx sessions list --project iacrmar                     # all engines, registered project
apx sessions list --engine claude                       # one engine, all projects
apx sessions list --engine codex --dir /path --limit 10 # one engine, one dir
```

Per engine: `DATE | SESSION ID | TITLE` newest first, plus the native-CLI resume command at the bottom. Without `--engine`, output is grouped with `══ <Engine> ══` headers. Empty engines print `(sin nada)`; uninstalled engines are omitted.

---

## Resuming by id (`apx session resume <id>`)

1. Searches every engine (apx → claude → codex).
2. **One match** → prints metadata (engine, path, cwd, title).
3. **Zero matches** → non-zero exit with `session "<id>" not found in any detected engine`.
4. **Multiple matches** → prints all, exit 2, asks for `--engine <id>`.

Flags:

| Flag | Effect |
|------|--------|
| `--engine <apx\|claude\|codex>` | Skip auto-detection. |
| `--tail N[k\|m]` | Print last N bytes (e.g. `--tail 32k`). No daemon. |
| `--full` / `--body` | Dump entire transcript. No daemon. |
| `--summary` | Tail → super-agent → 4-bullet summary. **Daemon + `super_agent.enabled`.** |
| `--continue` | Spawn engine's native CLI in resume mode (`claude --resume <id>`, `codex resume <id>`) in recorded cwd. |
| `--into apx[:slug]` | Create a new APX session whose body is the summary of `<id>`. Frontmatter records `parent_session: <engine>:<id>`. Default slug = original APX agent if any, else first agent in `AGENTS.md`. |
| `--project <name\|id\|path>` | Only for `--summary` on apx-native sessions. |

### Recipes

```bash
# Codex id → summary in apx
apx session resume 019abc... --summary

# Continue a Codex thread inside APX with the reviewer agent
apx session resume 019abc... --summary --into apx:reviewer

# Dump full transcript and grep
apx session resume 019abc... --full | rg "TODO"

# Re-open in native CLI
apx session resume 019abc... --continue

# Known Claude session, skip auto-detect
apx session resume 2e3c840b-... --engine claude --tail 16k
```

---

## Reading content (`apx session get`)

```bash
# Default: local APC project sessions
apx session get <id>             # metadata
apx session get <id> --body      # full markdown body
apx session get <id> --json      # machine-readable metadata

# Engine mode: any engine by id
apx session get <id> --engine claude --full
apx session get <id> --engine codex  --tail 16k
apx session get <id> --any --full                 # search all engines, error on collision
apx session get <id> --engine claude --json
```

**Use this to pull a Codex/Claude session into your current context.** Pipe `--full` into a file or prompt:

```bash
apx session get 019abc... --engine codex --full > /tmp/prev.jsonl
```

---

## Daemon requirements

| Capability | Daemon? |
|------------|---------|
| `find`, `list`, `get`, `resume <id>` (metadata/tail/full/continue) | no |
| `resume --summary`, `summary`, `ask` | yes (daemon + `super_agent.enabled` in `~/.apx/config.json`) |
| `resume --into apx[:slug]` | daemon needed only to compute embedded summary; without it the new session has an empty summary block |

If the daemon is down, `apx` auto-starts it when needed.

---

## Native APX session commands (legacy, still useful)

Manage APX-native sessions (`.md` files in `~/.apx/projects/.../sessions/`). They do **not** see Claude/Codex sessions.

```bash
apx session new <slug> --title "Investigate bug X"
apx session list                       # all agents in current APC project
apx session list <slug>
apx session update <id> --status "in progress"
apx session close <id> --result "Fixed in PR #42"
apx session check                      # exit 1 if any APX session is open
apx session close-stale                # auto-close >1h old
apx session compact <slug>             # summarize a conversation to disk
```

---

## Disambiguating collisions

```
$ apx session resume abc123
⚠️  session id "abc123" exists in multiple engines:
  - claude  /Users/.../-Volumes-work-repo/abc123.jsonl  (cwd: /Volumes/work/repo)
  - codex   /Users/.../sessions/2026/05/27/rollout-...-abc123.jsonl  (cwd: /Volumes/work/repo)
→ re-run with --engine <id> to pick one (apx | claude | codex)
```

Pick one with `--engine claude` or `--engine codex`.

---

## Tips for callers (LLMs)

1. **Start with `find`, not grep.** Never reconstruct via `apx sessions list | grep`.
2. **Don't ask the user which engine.** Auto-detect handles it; re-run with `--engine` only on collision.
3. **`summary` for the gist, `ask` for specifics.** Both need daemon + `super_agent.enabled`.
4. **`ask` on huge transcripts is slow and capped.** Raise `--max-chunks` if truncation warns and full coverage matters.
5. **Prefer `--tail N` over `--full`** when feeding raw transcripts to another model — JSONL is verbose, the tail is dense.
6. **`--into apx:slug`** is the bridge for "let's continue this in apx with the reviewer agent".
7. **Don't invent ids.** Discover them via `find` or `sessions list`.
8. **`apx session get --any --full`** is the simplest no-daemon import of any engine session.

---

## Quick reference

```bash
# Discovery
apx session find "<text>"                          # start here
apx session find "<text>" --deep
apx sessions list
apx sessions list --project <name>
apx sessions list --engine <id> --dir <path>

# Understand
apx session summary <id>
apx session ask <id> "<question>"

# Read
apx session get <id>                               # local APC metadata
apx session get <id> --engine <id> --full
apx session get <id> --any --tail 32k

# Resume / continue
apx session resume <id>
apx session resume <id> --summary
apx session resume <id> --continue
apx session resume <id> --into apx:<slug>
```
