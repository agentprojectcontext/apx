# The workflow — how a change moves through this repo

> Deep dive for [`AGENTS.md`](../../AGENTS.md). The hub names the stages; these are
> the playbooks. Each is **read-on-demand**: open the one for the stage you are
> in, not all eight.

Most code here is written by an agent, and the owner does not know every library
in the tree. That inverts what documentation is for. The scarce thing is not
knowledge of *how to write the code* — it is **evidence that the code does what
it claims**, in a form a human can check in a few minutes.

Every stage below exists to produce one piece of that evidence.

```
PLAN ──▶ IMPLEMENT ──▶ REVIEW (fresh context) ──▶ TEST + RUNTIME ──▶ OWNER BRIEF
              │                                          ▲
              ├── SECURITY, if it crosses a boundary ─────┤
              └── DRIFT, if it is structural ─────────────┘

                  INCIDENT MAP — when something is already broken
```

| Stage | File | Run it when |
|---|---|---|
| 1 | [`01-plan-change.md`](01-plan-change.md) | always, before the first edit |
| 2 | [`02-implement-change.md`](02-implement-change.md) | always |
| 3 | [`03-independent-review.md`](03-independent-review.md) | anything beyond a typo |
| 4 | [`04-security-risk-review.md`](04-security-risk-review.md) | auth, shell, filesystem, network, secrets, tools, an inbound channel |
| 5 | [`05-test-and-runtime.md`](05-test-and-runtime.md) | always — this is the one that decides whether "done" is true |
| 6 | [`06-architecture-drift.md`](06-architecture-drift.md) | new module, new family, moved logic, new dependency |
| 7 | [`07-owner-brief.md`](07-owner-brief.md) | always — it is what the owner actually reads |
| 8 | [`08-incident-map.md`](08-incident-map.md) | something is broken and you don't know why yet |

## The three rules that make the rest work

1. **Self-review is not review.** Stage 3 means *fresh context* — a reader who
   has not seen the reasoning that produced the change. An agent re-reading its
   own diff confirms its own assumptions; that is what stage 3 exists to break.
2. **Unverified is a valid answer. Silence is not.** If you could not run
   something, say `UNVERIFIED` and why. Never let "the tests passed" stand in
   for "the changed path ran". See stage 5.
3. **Restart before you conclude anything.** The daemon holds the code it booted
   with. A conclusion drawn without `apx restart` is a conclusion about the old
   code — this repo's most expensive recurring mistake, by a distance.
