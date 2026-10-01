---
category: Chat
---
# SubthreadCard

An agent asked another agent something (agent ↔ agent sub-thread). Shows the asked agent's `avatar`, the `title` of the request, a `subtitle` ("Roby → Scout"), a state (`status` + `statusLabel`, spinner while running) and a `summary` clamped to three lines. The whole card is a button that opens the sub-thread.

```tsx
<SubthreadCard avatar={<AgentAvatar name="Scout" blob="rubi" size={28} animated={false} />}
  title="Buscar 3 hoteles en Lima" subtitle="Roby → Scout" status="done" statusLabel="Listo"
  summary="Encontré tres opciones entre USD 80 y 140 por noche." onOpen={() => {}} />
```
