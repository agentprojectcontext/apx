---
category: Forms
---
# Field

A labelled form row: label on top, the control, a muted hint (or a red `error`). Pass a function as children to get
the `id` the label points at.

```tsx
<Field label="Title" hint="What has to happen">{(id) => <Input id={id} />}</Field>
```
