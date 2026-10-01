---
category: Chat
---
# SubthreadCard

An agent asked another agent something (agent ↔ agent sub-thread). Shows the asked agent's `avatar`, the `title` of the request, a `subtitle` ("Roby → Scout"), a state (`status` + `statusLabel`, spinner while running) and a `summary` clamped to three lines. The whole card is a button that opens the sub-thread.

```tsx
<SubthreadCard avatar={<AgentAvatar name="Scout" blob="rubi" size={28} animated={false} />}
  title="Find 3 hotels in Lima" subtitle="Roby → Scout" status="done" statusLabel="Done"
  summary="Found three options between USD 80 and 140 a night." onOpen={() => {}} />
```
