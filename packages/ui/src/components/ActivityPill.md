---
category: Chat
---
# ActivityPill

Live activity between agents: animated dots + label, flanked by `from` avatars (an AvatarStack) and a `to` avatar for handoffs. Centered under the last message while agents talk to each other.

```tsx
<ActivityPill tone="danger" label="Sending to Roby…" from={<AgentAvatar name="Ledger" blob="menta" size={24} />} to={<AgentAvatar name="Roby" blob="noche" size={24} />} />
```
