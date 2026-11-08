---
category: Forms
---
# SegmentedControl

2–4 mutually exclusive options in one pill: view switches (Chat / Tasks), send mode (Auto / Ask / Plan), theme (Light / Dark). Selected item lifts to a white segment.

- More than 4 options → Tabs or a Menu.
- `disabled` shows the choice without letting it change, when another setting fixes it; say why in the row's text.

```tsx
<SegmentedControl options={[{ value: "chat", label: "Chat" }, { value: "tasks", label: "Tasks" }]} />
```
