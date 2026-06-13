---
name: apx-task
description: Per-project TODO list. Event-sourced, project-scoped, addressable by short id prefix. Load when user wants to note, remind, list, or complete a task. Triggers: 'add a task', 'remind me to…', 'what's pending', 'mark as done', 'open tasks'.
---

# apx-task

A `task` is a per-project TODO. Append-only JSONL event log per month at `~/.apx/projects/<apxId>/tasks/YYYY-MM.jsonl`. State is the fold of the event stream. Once created a task lives forever — `done` and `drop` record state transitions, don't delete events. `reopen` flips back to `open`.

## Concrete CLI calls

```bash
# Add
apx task add "Review the auth bug" --project iacrmar
apx task add "Call the client" --project iacrmar --due 2026-05-30 --tag urgent
apx task add "Demo for tester X" --project iacrmar --agent reviewer --tag demo --tag external --source cli

# List (defaults to open)
apx task list --project iacrmar
apx task list --project iacrmar --state all
apx task list --project iacrmar --state done
apx task list --project iacrmar --tag urgent
apx task list --project iacrmar --due-before 2026-06-01
apx task list --project iacrmar --limit 5

# Inspect / mutate
apx task show t_abc123 --project iacrmar
apx task show abc       --project iacrmar    # prefix match (≥3 chars, unique)
apx task done    t_abc123 --project iacrmar --by manuel
apx task drop    t_abc123 --project iacrmar               # archived (not "done")
apx task reopen  t_abc123 --project iacrmar
apx task patch   t_abc123 --project iacrmar --title "New title" --due 2026-06-10
apx task patch   t_abc123 --project iacrmar --tag bug --tag blocker   # replaces tags
```

## ID format

`t_` + 6 base36 chars (~4B keyspace). Prefix matching works at ≥3 chars when the prefix is unique. If two tasks share a prefix you get null — use a longer one.

## Fields

| Field | When | Notes |
|---|---|---|
| `title` | always | One imperative line. Required. |
| `body` | optional | Longer notes. Markdown OK. |
| `tags` | optional | Free-form. Used by `--tag` filter. |
| `due` | optional | ISO `YYYY-MM-DD`. Supports `--due-before`. |
| `agent` | optional | Slug of responsible agent. Used by `--agent` filter. |
| `source` | auto/optional | Origin (cli, telegram, super-agent). |
| `state` | derived | `open` after create, `done`/`dropped` after ops. |

## Super-agent tools

The super-agent has `create_task` and `list_tasks`. "Note that we need to close the auth bug in iacrmar tomorrow" → model calls:

```json
{ "name": "create_task",
  "arguments": { "project": "iacrmar", "title": "Close the auth bug", "due": "<tomorrow>", "tags": ["bug"] } }
```

"What's pending in iacrmar?" → `list_tasks({ project: "iacrmar" })`. If user doesn't say which project, `list_projects` first and ask — never assume. If the channel has pinned project context (Telegram), use that.

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
GET    /projects/:pid/tasks                  ?state=open|done|dropped|all&tag=X&agent=Y&due_before=ISO&limit=N
POST   /projects/:pid/tasks                  { title, body?, tags?, due?, agent?, source?, meta? }
GET    /projects/:pid/tasks/:id
PATCH  /projects/:pid/tasks/:id              { patch: {...} }
POST   /projects/:pid/tasks/:id/done         { by? }
POST   /projects/:pid/tasks/:id/drop         { by? }
POST   /projects/:pid/tasks/:id/reopen
GET    /projects/:pid/tasks-summary          → { open, done, dropped, overdue, total }
```

## Don't

- Don't use tasks for reminders that need to *fire* — that's a future routine kind (`task-due-notify`, not built). Tasks are a list, not a scheduler.
- Don't depend on `done` deleting the task. It doesn't. Event log stays.
- Don't grep `~/.apx/projects/<id>/tasks/*.jsonl` for state — use `apx task list` or `getTask()`. Fold logic isn't trivial (later events override fields).
