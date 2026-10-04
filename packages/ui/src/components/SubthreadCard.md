---
category: Chat
---
# SubthreadCard

An agent asked another agent (or a worker it started) something. The head shows the asked agent's `avatar`, the
`title` of the request, a `subtitle` ("Roby → Scout") and a state (`status` + `statusLabel`, spinner while running);
it is a button that opens the sub-thread. Under it, the `summary` (the report handed back, usually rendered Markdown)
folds to a few lines with a "Show more" toggle when it is long, and `meta` closes the card ("Done · took 3 min 10 s").

```tsx
<SubthreadCard avatar={<AgentAvatar name="Scout" blob="rubi" size={28} animated={false} />}
  title="Find 3 hotels in Lima" subtitle="Roby → Scout" status="done" statusLabel="Done"
  summary="Found three options between USD 80 and 140 a night." meta="Took 42 s"
  moreLabel="Show more" lessLabel="Show less" onOpen={() => {}} />
```
