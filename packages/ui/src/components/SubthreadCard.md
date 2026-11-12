---
category: Chat
---
# SubthreadCard

An agent asked another agent (or a worker it started) something. One row: a chevron, the asked agent's `avatar`, the
`title` of the request and a `subtitle` ("Roby → Scout") on the left; its state (`status` + `statusLabel`, spinner while
running) and `time` on the right. The whole row unfolds the card, like the app's other folding rows: the `summary` (the
answer handed back, usually rendered Markdown), a `meta` line ("Failed: send mail") and, at its foot, the action that
opens the sub-thread (`onOpen`, `openLabel`). It starts folded unless `defaultOpen`.

```tsx
<SubthreadCard avatar={<AgentAvatar name="Scout" blob="rubi" size={24} animated={false} />}
  title="Find 3 hotels in Lima" subtitle="Roby → Scout" status="done" statusLabel="Done" time="42 s"
  summary="Found three options between USD 80 and 140 a night." openLabel="Open Scout's chat" onOpen={() => {}} />
```
