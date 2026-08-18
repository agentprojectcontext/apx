---
name: apx-commitment
description: Promises made to a named person — counterparty, the date you gave them, the channel you said it on. Sibling of apx-task, deliberately NOT the same thing. Load whenever someone else is waiting on something. Triggers: 'I told X I would…', 'le dije a X que…', 'I promised…', 'quedé en…', 'me comprometí a…', 'what do I owe X', 'qué le debo a X', 'overdue promises', 'mark it kept', 'push the date'.
---

# apx-commitment

A `task` is something to do. A `commitment` is something **promised to a specific person**: it has a counterparty, a date you gave them, and the channel you said it on. Breaking one costs trust, not throughput.

Append-only JSONL per month at `~/.apx/projects/<apxId>/commitments/YYYY-MM.jsonl`, folded the same way as tasks. Nothing is ever deleted.

## When it is a commitment and not a task

The test is one question: **is a named person waiting?**

| What was said | Which | Why |
|---|---|---|
| "I have to send the quote" | task | Nobody is named. |
| "I told Ana I'd send her the quote Friday" | commitment | Ana is waiting, and Friday is a date you gave her. |
| "we should refactor the parser" | task | Internal work. |
| "I promised the client a demo next week" | commitment | The client will notice if it slips. |
| "remind me to review the PR" | task | A reminder to yourself. |
| "I said I'd get back to Bruno today" | commitment | Bruno is expecting it. |

Undated is still a commitment. "I promised Ana the quote, no date yet" → record it with no `due`. Refusing to record it because a date is missing means the promise goes unrecorded, which is strictly worse.

## Catching them in conversation

This is the main way they get recorded — nobody opens a form to log a promise. Listen for a name plus an obligation, in either language:

- "le dije a Ana que el viernes le mando el presupuesto"
- "quedé en pasarle el informe a Bruno"
- "me comprometí con el cliente a tener la demo el 10"
- "I told the team I'd have the migration plan by Thursday"

Record it and say in ONE line what you filed and for whom. Do not ask permission to record something you clearly heard — asking makes recording cost more than not recording, and then nothing gets recorded.

Resolve a loose date to a real one ("Friday" → that date) and say which date you used, so a wrong guess is visible and correctable.

## Super-agent tools

`record_commitment` and `list_commitments`. Both are in the base set — a promise is caught mid-sentence, so they are always loaded.

```json
{ "name": "record_commitment",
  "arguments": { "project": "acme", "counterparty": "Ana",
                 "body": "send the revised quote", "due": "2026-05-30",
                 "origin_channel": "telegram" } }
```

`list_commitments` searches **every project** unless you pass one. Omit `project` for "what do I owe people" — that question does not respect a repo boundary.

```json
{ "name": "list_commitments", "arguments": { "overdue": true } }
{ "name": "list_commitments", "arguments": { "counterparty": "ana" } }
```

Counterparty matching is case-insensitive substring, so `"ana"` finds "Ana Pérez". It is free text, not a contact record — write the name the way the owner says it.

## Concrete CLI calls

```bash
# Record
apx commitment add "send the revised quote" --to "Ana" --due 2026-05-30 --project acme
apx commitment add "the deck for the board" --to "Bruno" --project acme   # no date yet

# Read
apx commitment list --all                      # every project, soonest deadline first
apx commitment list --all --overdue            # what you owe and already missed
apx commitment list --to Ana --state all       # everything ever promised to her
apx commitment show c_abc123 --project acme

# Close it out
apx commitment kept   c_abc123 --project acme
apx commitment missed c_abc123 --project acme --note "forgot entirely"
apx commitment renegotiate c_abc123 --due 2026-06-15 --project acme --note "agreed on the call"
```

## The three ways one ends

| Verb | Means | State after |
|---|---|---|
| `kept` | Delivered. | `kept` |
| `missed` | The date passed and it did not happen. | `missed` |
| `renegotiate` | A NEW date, agreed with them. | back to `open` |

**`renegotiate` reopens rather than closing.** A promise with a new date is a live promise, and every date it has ever had stays in `history`. Moving a date twice is a fact about the relationship; it is only visible because the log keeps it.

**`missed` records, it does not hide.** A system that quietly drops what you failed to do cannot tell you that you keep failing the same person.

Never mark `kept` on the owner's behalf. If a commitment came due, ASK whether it was kept — you cannot see whether the email was sent.

## Where they show up on their own

- **The morning anchor leads with them.** Overdue promises go first, named as a promise to a person, never folded into the task list.
- **`overdue_commitment` is a CRITICAL signal** (`core/routines/signals.js`), the only detector at that severity. It is the one thing allowed to cross a spent interruption budget.
- **`commitment_due` fires inside the lead window** (default 48h) — a warning that arrives in time is worth more than one that arrives after.

## ID format

`c_` + 6 base36 chars. Prefix matching at ≥3 chars when unique, same as tasks.

## Endpoint surface

```
GET    /api/commitments                                   cross-project; ?state=open|kept|missed|all
                                                          &counterparty=X&overdue=1&due_before=ISO
                                                          &sort=due|newest&limit=N&offset=N
GET    /api/projects/:pid/commitments                     same filters, one project
POST   /api/projects/:pid/commitments                     { counterparty, body, due?, origin_channel?, … }
GET    /api/projects/:pid/commitments/:id
PATCH  /api/projects/:pid/commitments/:id                 { patch: {...} }
POST   /api/projects/:pid/commitments/:id/kept            { note? }
POST   /api/projects/:pid/commitments/:id/missed          { note? }
POST   /api/projects/:pid/commitments/:id/renegotiate     { due, note? }
GET    /api/projects/:pid/commitments-summary             → { open, kept, missed, overdue, total }
```

## Don't

- **Don't record a task as a commitment to make it feel urgent.** The whole value is that a commitment means someone is waiting. Inflate the type and the morning anchor becomes noise.
- **Don't use tags on tasks for this.** It was considered and rejected: the day you want "everything I owe Ana" you would be substring-matching titles, and `kept` vs `renegotiated` — the distinction that tells you whether a relationship is fine — has nowhere to live.
- **Don't invent a counterparty.** If you genuinely cannot tell who is waiting, it is a task.
- **Don't renegotiate without a date.** The CLI refuses it: a promise with no new date is a promise that vanished.
