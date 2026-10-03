---
category: Layout
---
# ResizeHandle

The edge of a column you drag to change its width: the sidebar, the chat list, a list beside its detail
(`MasterDetail`). It is a WAI-ARIA window splitter: focusable, arrows move it 16px, a double click resets it.

- `width`, `min`, `max`: the column's width now and its limits (px).
- `onResize(width)`: called while dragging; the caller keeps the width (and remembers it if it wants).
- `onReset`: double click, back to the default.
- `edge`: the side of the column it sits on (`right` by default).

Place it inside the column (positioned) or over the line between two columns.

```tsx
<aside style={{ width }} className="relative">
  …
  <ResizeHandle width={width} min={200} max={360} onResize={setWidth} label="Resize the sidebar" />
</aside>
```
