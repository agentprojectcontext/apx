---
category: Actions
---
# IconButton

Icon-only button. `label` is required (it becomes aria-label and the native title).

- `shape="circle"` for floating/composer actions, `square` (default) for toolbars and row actions.
- `variant`: `ghost` (default), `secondary`, `outline`, `primary` (the one round send/mic action).
- `active` marks a toggled tool (e.g. tools panel open) — green icon.
- Wrap in `Tooltip` when the icon alone is ambiguous.

```tsx
<IconButton label="More" icon={<Icons.Ellipsis />} />
```
