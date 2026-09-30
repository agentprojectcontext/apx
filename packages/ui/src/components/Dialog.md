---
category: Overlays
---
# Dialog

Modal for confirmations and short forms: `title`, `description`, body `children`, `footer` actions (secondary then primary, right-aligned).

- APX never uses modals for notices or updates — use a Card/banner instead.

```tsx
<Dialog defaultOpen title="Delete routine?" description="Overnight outbound stops running. Past runs stay in the log."
  footer={<><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></>} />
```
