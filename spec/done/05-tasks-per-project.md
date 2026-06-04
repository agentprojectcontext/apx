# 05 — Tasks (TODOs) per project

**Priority**: P1
**Size**: M
**Status**: idea

## Problem

APX projects have agents, memory, sessions, conversations, routines, MCPs, artifacts. They do NOT have tasks. The user needs lightweight per-project task tracking so the super-agent (or any agent) can:

- Create a task ("Manú: cuando puedas, revisá el bug de auth").
- List open tasks for a project.
- Mark done.
- Get pinged from Telegram about pending tasks.
- See cross-project task counts from `apx status`.

This is NOT a full project management system — it's a fast, file-backed TODO list with timestamps and tags. No assignees beyond "agent or human", no Gantt, no deadlines beyond an optional `due` field.

## Schema

`~/.apx/projects/<apxId>/tasks/<YYYY-MM>.jsonl` — append-only JSONL, one task event per line:

```json
{ "id": "t_abc123", "ts": "2026-05-27T17:42:00Z", "op": "create",
  "title": "Revisar bug de auth",
  "body": null,
  "tags": ["bug", "auth"],
  "due": "2026-05-30",
  "agent": null,                 // optional: who is responsible
  "source": "telegram",          // channel/source that created it
  "meta": {} }
{ "id": "t_abc123", "ts": "2026-05-28T10:00:00Z", "op": "update",
  "patch": { "tags": ["bug", "auth", "blocker"] } }
{ "id": "t_abc123", "ts": "2026-05-28T18:15:00Z", "op": "done",
  "by": "manuel" }
```

In-memory projection: latest state of each id derived from the event stream. State = `open | done | dropped`.

## CLI

```bash
apx task add "<title>" [--project X] [--tag bug] [--due 2026-05-30] [--agent reviewer]
apx task list   [--project X] [--state open|done|all] [--tag X] [--due-before D]
apx task show <id>
apx task done <id>  [--project X]
apx task drop <id>  [--project X]   # archived without "completed" semantics
apx task touch <id> --tag X --due Y --agent Z   # patch a field
```

Resolution rules:
- `--project` accepts id, name, or path; without it: cwd-rooted project if any, else first non-default.
- Task IDs are short and stable (`t_` + 6 base36 chars). Listing uses prefixes.

## Tool for the super-agent

`create_task({ project, title, body?, tags?, due?, agent? }) → { id }` so the model can take "Manú: anotá que mañana hay que llamar al cliente" and call the tool. Listing tool too: `list_tasks({ project, state, tag, due_before })`.

## HTTP

```
GET    /projects/:pid/tasks                      (filters in query: state, tag, due_before)
POST   /projects/:pid/tasks                      (body = create event payload)
GET    /projects/:pid/tasks/:id
PATCH  /projects/:pid/tasks/:id                  (body = patch payload)
POST   /projects/:pid/tasks/:id/done
POST   /projects/:pid/tasks/:id/drop
```

## Status integration

`apx status` gains a "Tasks" section per project: open count, overdue count.

## Files to touch

- `src/core/tasks-store.js` (new) — append, project, query.
- `src/host/daemon/api/tasks.js` (new) — routes.
- `src/host/daemon/api.js` — mount.
- `src/host/daemon/super-agent-tools/tools/create-task.js` + `list-tasks.js` (new).
- `src/host/daemon/super-agent-tools/index.js` — register.
- `src/interfaces/cli/commands/task.js` (new).
- `src/interfaces/cli/index.js` — register `task` command.
- `tests/tasks-store.test.js` (new).

## Done criteria

- [ ] `apx task add` creates a task in the right project.
- [ ] `apx task list` shows open tasks; `--state done` shows closed.
- [ ] Super-agent can create a task from a Telegram message ("recordame que…").
- [ ] `apx status` shows task counts per project.
- [ ] Events are append-only and a corrupt line doesn't break the projection (skip + warn).

## Open questions

- Reminders / due notifications: out of scope for v1. Could be wired via a future `task-due-notify` routine kind.
- Sub-tasks / dependencies: out of scope.

## Owner

Self (Opus).
