---
name: apx-task
description: Per-project TODO list. Event-sourced, project-scoped, addressable by short id prefix. Load when user wants to note, remind, list, or complete a task. Triggers: 'add a task', 'remind me to…', 'what's pending', 'mark as done', 'open tasks'.
---

# apx-task

A `task` is a per-project TODO. Append-only JSONL event log per month at `~/.apx/projects/<apxId>/tasks/YYYY-MM.jsonl`. State is the fold of the event stream. Once created a task lives forever — `done` and `drop` record state transitions, don't delete events. `reopen` flips back to `open`.

## Concrete CLI calls

```bash
# Add
apx task add "Review the auth bug" --project acme
apx task add "Call the client" --project acme --due 2026-05-30 --tag urgent
apx task add "Demo for tester X" --project acme --agent reviewer --tag demo --tag external --source cli

# List (defaults to open)
apx task list --project acme
apx task list --all                          # every registered project, each row labelled
apx task list --all --status blocked         # what is stuck, everywhere
apx task list --all --updated-since 2026-08-01T00:00:00Z   # what moved
apx task list --project acme --status in_review
apx task list --project acme --state all
apx task list --project acme --state done
apx task list --project acme --tag urgent
apx task list --project acme --due-before 2026-06-01
apx task list --project acme --limit 5

# Inspect / mutate
apx task show t_abc123 --project acme
apx task show abc       --project acme    # prefix match (≥3 chars, unique)
apx task done    t_abc123 --project acme --by manuel
apx task drop    t_abc123 --project acme               # archived (not "done")
apx task reopen  t_abc123 --project acme
apx task patch   t_abc123 --project acme --title "New title" --due 2026-06-10
apx task patch   t_abc123 --project acme --tag bug --tag blocker   # replaces tags
```

## ID format

`t_` + 6 base36 chars (~4B keyspace). Prefix matching works at ≥3 chars when the prefix is unique. If two tasks share a prefix you get null — use a longer one.

## Fields

| Field | When | Notes |
|---|---|---|
| `title` | always | One imperative line. Required. |
| `body` | optional | Longer notes. Markdown OK. |
| `tags` | optional | Free-form. Used by `--tag` filter. |
| `due` | optional | ISO `YYYY-MM-DD`. Filter with `--due-before` / `--due-after`. |
| `agent` | optional | Slug of responsible agent. Used by `--agent` filter. |
| `source` | auto/optional | Origin (cli, telegram, super-agent). |
| `state` | derived | Storage lifecycle: `open` after create, `done`/`dropped` after ops. |
| `status` | sub-status | How an **open** task is progressing — `pending` (default) \| `running` \| `in_review` \| `blocked`. Orthogonal to `state`. Filter with `--status`; set via `POST …/tasks/:id/status` (the CLI `patch` does not set it). |

## Super-agent tools

The super-agent has `create_task`, `list_tasks`, and **`complete_task`** (done | drop | reopen | status). Add, list, and close all happen with tools — no shelling out to `apx task done`. "Note that we need to close the auth bug in acme tomorrow" → model calls:

```json
{ "name": "create_task",
  "arguments": { "project": "acme", "title": "Close the auth bug", "due": "<tomorrow>", "tags": ["bug"] } }
```

"What's pending in acme?" → `list_tasks({ project: "acme" })`. If user doesn't say which project, `list_projects` first and ask — never assume. If the channel has pinned project context (Telegram), use that.

## Anti-examples

```bash
# DON'T add tasks without --project for real work.
apx task add "Stuff"            # falls back to first registered project (or default=0)

# DON'T use `done` when the task is no longer relevant. Use `drop`.
apx task done t_abc            # "I completed this work"
apx task drop t_abc            # "no longer needed; archive without completion"
# Reporting/metrics distinguish them.
```

## Endpoint surface

```
GET    /api/tasks                                cross-project; same filters, plus ?offset
GET    /api/projects/:pid/tasks                  ?state=open|done|dropped|all&status=pending|running|in_review|blocked&tag=X&agent=Y&due_before=ISO&due_after=ISO&updated_since=ISO&limit=N
POST   /api/projects/:pid/tasks                  { title, body?, tags?, due?, agent?, source?, meta? }
GET    /api/projects/:pid/tasks/:id
PATCH  /api/projects/:pid/tasks/:id              { patch: {...} }
POST   /api/projects/:pid/tasks/:id/done         { by? }
POST   /api/projects/:pid/tasks/:id/drop         { by? }
POST   /api/projects/:pid/tasks/:id/reopen
POST   /api/projects/:pid/tasks/:id/status       { status: pending|running|in_review|blocked }
GET    /api/projects/:pid/tasks-summary          → { open, done, dropped, overdue, total, status:{…} }
```

## Don't

- Don't use tasks for reminders that need to *fire* — that's a future routine kind (`task-due-notify`, not built). Tasks are a list, not a scheduler.
- Don't depend on `done` deleting the task. It doesn't. Event log stays.
- Don't grep `~/.apx/projects/<id>/tasks/*.jsonl` for state — use `apx task list` or `getTask()`. Fold logic isn't trivial (later events override fields).
