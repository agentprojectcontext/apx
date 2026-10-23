---
category: Overlays
---
# Help

A small "?" placed right after a title or a field's label. Hovering it (or clicking it) opens a panel that explains
the choice: one line per option (`items`: what it is, when to use it) and/or free text (`children`). Unlike Tooltip the
pointer can move onto the panel to read it; it closes on leaving, a second click, an outside click or Escape.

- Use it where the words alone do not say when to pick each option (task columns, task types), not on every label.
- `label` names the button and the panel ("About columns").

```tsx
<Help
  label="About columns"
  title="Columns"
  items={[
    { term: "To do", text: "Decided; it is next." },
    { term: "Doing", text: "Someone is working on it now." },
  ]}
/>
```
