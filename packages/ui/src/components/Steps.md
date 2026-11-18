---
category: Display
---
# Steps

A short trail of numbered steps in a dialog that walks through them ("1 Add — 2 Connect"). The ones before `current`
show a green check, the current one is filled; `current = steps.length` shows them all done. Two or three steps at
most: more is a page, not a dialog. CSS in `@apx/ui/summary.css`.

```tsx
<Steps steps={["Add", "Connect"]} current={1} />
```
