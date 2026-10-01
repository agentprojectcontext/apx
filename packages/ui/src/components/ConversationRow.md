---
category: Navigation
---
# ConversationRow

A thread in the conversation list: `avatar` (AgentAvatar, or AvatarStack for groups), `title`, `time`, one-line `preview`.

- `titleTag` for the role (`<Tag kind="role">Super-agente</Tag>`); `tags` for context chips under the title (project, channel, "Agente ↔ agente") — the classic, denser row.
- `meta` adds a third 11px line under the preview ("12 sesiones · Web", "Grupo · 3 agentes").
- `unread` shows a counter and bolds the row; `typing` replaces the preview with a live line; `selected` highlights (grey in minimal, green outline in classic).

```tsx
<ConversationRow avatar={<AgentAvatar name="Roby" blob="noche" size={34} />} title="Roby" time="1:35 p. m." preview="Done." selected />
```
