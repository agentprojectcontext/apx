---
category: Display
---
# Tag

Small metadata chip.

- `kind="role"` — agent role next to a name ("Super-agente"). Minimal: soft green pill. Classic: mono UPPERCASE with green outline (the v1 look).
- `kind="meta"` (default) — context under a row: project (`icon={<Icons.Folder />}`), channel ("Telegram"), relation ("Agente ↔ agente").
- `kind="skill"` — skill/tool reference in a message: mono, dashed border.

```tsx
<Tag kind="role">Super-agente</Tag>
```
