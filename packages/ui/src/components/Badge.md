---
category: Display
---
# Badge

Status pill or counter.

- `tone`: neutral, brand (ok/active), violet (agents), info, warning (needs you), danger (failed/unread).
- `variant`: `soft` (default), `solid` (counters: `<Badge tone="danger" variant="solid">5</Badge>`), `outline` (quiet state like "Draft").
- `dot` adds a leading status dot ("● You're in control").
- For context chips (project, channel, role) use Tag.

```tsx
<Badge tone="warning" dot>You're in control</Badge>
```
