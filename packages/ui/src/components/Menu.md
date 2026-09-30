---
category: Actions
---
# Menu

Dropdown / overflow menu driven by an `items` array: `{ label, icon, shortcut, danger, disabled, onSelect }`, `{ type: "separator" }`, `{ type: "label", label }`.

- Trigger is any single element, usually `<IconButton icon={<Icons.Ellipsis />} />`.
- Put destructive items last, after a separator, with `danger`.
- Renders into the ApxProvider portal, so it keeps the look.

```tsx
<Menu trigger={<IconButton label="Actions" icon={<Icons.Ellipsis />} />} items={[
  { label: "Rename", icon: <Icons.Pencil /> },
  { label: "Pin", icon: <Icons.Pin />, shortcut: "⌘P" },
  { type: "separator" },
  { label: "Delete", icon: <Icons.Trash2 />, danger: true },
]} />
```
