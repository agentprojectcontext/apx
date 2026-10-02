---
category: Actions
---
# ContextMenu

Right-click (long press on touch) menu over its children, with the same `items` as `Menu`: checks, danger items and
`{ type: "submenu", label, items }`. `disabled` turns it off (while dragging, for instance).

```tsx
<ContextMenu items={[
  { type: "submenu", label: "Move to", items: columns.map((c) => ({ label: c.label, checked: c.id === status })) },
  { type: "separator" },
  { label: "Delete", danger: true },
]}>
  <TaskRow task={task} />
</ContextMenu>
```
