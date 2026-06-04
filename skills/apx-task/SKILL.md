---
name: apx-task
description: Per-project TODO list. Load when the user says "anotame", "recordame que…", "qué tengo pendiente", "marca como hecho". Tasks are project-scoped, event-sourced, and addressable by short id prefix.
---

# apx-task

A `task` is a per-project TODO. Append-only JSONL event log per month under `~/.apx/projects/<apxId>/tasks/YYYY-MM.jsonl`. State is the fold of the event stream. Once created, a task lives forever — `done` and `drop` don't delete events, they record a state transition. `reopen` flips back to `open`.

## Concrete CLI calls

```bash
# Add — most common
apx task add "Revisar bug de auth" --project iacrmar
apx task add "Llamar al cliente" --project iacrmar --due 2026-05-30 --tag urgent
apx task add "Demo a tester X"   --project iacrmar --agent reviewer --tag demo --tag external

# List (defaults to open)
apx task list --project iacrmar
apx task list --project iacrmar --state all
apx task list --project iacrmar --state done
apx task list --project iacrmar --tag urgent
apx task list --project iacrmar --due-before 2026-06-01
apx task list --project iacrmar --limit 5

# Inspect / mutate
apx task show t_abc123 --project iacrmar
apx task show abc       --project iacrmar    # prefix match (≥3 chars), unique
apx task done    t_abc123 --project iacrmar --by manuel
apx task drop    t_abc123 --project iacrmar               # archived (not "done")
apx task reopen  t_abc123 --project iacrmar
apx task patch   t_abc123 --project iacrmar --title "Nuevo título" --due 2026-06-10
apx task patch   t_abc123 --project iacrmar --tag bug --tag blocker   # replaces tags
```

## ID format

`t_` + 6 base36 chars (32-bit entropy → ~4B keyspace). Prefix matching works once you have ≥ 3 chars and the prefix uniquely identifies a task. If two tasks share a prefix, you get null — use a longer one.

## Fields

| Field | When | Notes |
|---|---|---|
| `title` | always | One imperative line. Required. |
| `body` | optional | Longer notes. Markdown OK. |
| `tags` | optional | Free-form strings. Used by `--tag` filter. |
| `due` | optional | ISO date `YYYY-MM-DD`. Listing supports `--due-before`. |
| `agent` | optional | Slug of an agent responsible. Used by `--agent` filter. |
| `source` | auto/optional | Where the task came from (cli, telegram, super-agent). |
| `state` | derived | `open` after create, `done` / `dropped` after their respective ops. |

## Super-agent tools

The super-agent has `create_task` and `list_tasks` tools. So a user message like "Anotame que mañana hay que cerrar el bug de auth en iacrmar" makes the model call:

```json
{ "name": "create_task",
  "arguments": { "project": "iacrmar", "title": "Cerrar bug de auth", "due": "<tomorrow>", "tags": ["bug"] } }
```

When the user asks "qué tengo pendiente en iacrmar?", the model calls `list_tasks({ project: "iacrmar" })`.

If the user doesn't say which project, the model should `list_projects` first and ask which one — never assume. If the conversation has a project context (Telegram channel pinned to project), the model uses that.

## Anti-examples

```bash
# DON'T add tasks without --project for real work.
apx task add "Stuff"            # falls back to first registered project (or default=0)
# ↑ Will dump into a project you may not have meant. Always --project.

# DON'T use `done` when the task is no longer relevant. Use `drop`.
apx task done t_abc            # implies "I completed this work"
apx task drop t_abc            # implies "this is no longer needed; archive without completion"
# Reporting / metrics distinguish them.
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

- Don't use tasks for reminders that need to *fire* — that's a future routine kind (`task-due-notify`, not built yet). Tasks are a list, not a scheduler.
- Don't depend on `done` deleting the task. It doesn't. The event log stays.
- Don't grep `~/.apx/projects/<id>/tasks/*.jsonl` for state — use `apx task list` or `getTask()`. The fold logic isn't trivial (later events can override fields).
