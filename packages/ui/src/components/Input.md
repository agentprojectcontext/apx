---
category: Forms
---
# Input

Single-line text field with optional `leadingIcon` and `trailing` slot. Soft filled pill in minimal, bordered box in classic.

- `size`: `sm` in sidebars/filters, `md` in forms, `lg` in onboarding.
- `invalid` for errors — pair with a helper line in `--apx-danger`.
- For search boxes use SearchField; for multi-line use Textarea; for chat use Composer.

```tsx
<Input placeholder="Project name" leadingIcon={<Icons.Folder size={15} />} />
```
