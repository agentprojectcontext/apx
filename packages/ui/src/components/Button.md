---
category: Actions
---
# Button

Text button.

- `primary` — the single main action of a view or card ("Send email", "Get started"). Ink in minimal, APX green in classic.
- `secondary` — soft fill, the companion of primary ("Discard", "Contact sales").
- `ghost` — toolbar and low-emphasis actions; `outline` — neutral action on busy surfaces; `danger` — destructive (soft red, solid on hover); `link` — inline.
- Sizes `sm` (cards, toolbars), `md` (default), `lg` (hero, onboarding).
- Don't put two primaries side by side; don't use Button for icon-only actions (use IconButton).

```tsx
<div style={{ display: "flex", gap: 8 }}>
  <Button>Send email</Button>
  <Button variant="secondary">Discard</Button>
</div>
```
