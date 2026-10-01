---
category: Overlays
---
# Popover

Anchored panel (raised surface, border, `radius-md`, `shadow-md`) with any content: the topbar process list, a share picker, a small form. Menu is for a plain list of actions.

- Controlled (`open` / `onOpenChange`) or uncontrolled. Closes on outside click and Escape.
- Renders into the ApxProvider portal, so it keeps the look.

```tsx
<Popover align="end" width={360} trigger={<Button size="sm">En curso</Button>}>
  <SegmentedControl options={[{ value: "a", label: "Agentes" }, { value: "b", label: "Segundo plano" }]} />
</Popover>
```
