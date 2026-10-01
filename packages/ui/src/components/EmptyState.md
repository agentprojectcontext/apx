---
category: Display
---
# EmptyState

Placeholder for an empty list or pane, a pane that is still waiting for data, or a failed load: `icon`, `title`, one line of text and an optional `action` Button.

- `variant="plain"` (default) centers it in a whole pane (no chat selected, no apps); `dashed` draws the 1px dashed box used inside lists and cards ("Nada corriendo en este proyecto.").
- `size="lg"` for a full screen; `sm` for panels and lists.

```tsx
<EmptyState icon={<Icons.Inbox />} title="No hay chats" action={<Button size="sm">Nuevo chat</Button>}>
  Escribile a Roby para empezar.
</EmptyState>
```
