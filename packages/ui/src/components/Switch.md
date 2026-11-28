---
category: Forms
---
# Switch

On/off setting that applies immediately. With `label`/`description` it renders a full settings row (text left, switch right).

- Track uses the selection color: ink in minimal, APX green in classic.
- Without a visible `label`, pass `aria-label` so screen readers can name it.
- Use `aria-describedby` to associate shared scope or other nearby help with the control.
- Use Checkbox for multi-select lists and for choices confirmed by a Save button.

```tsx
<Switch label="Send voice replies" description="Answer voice notes with voice." defaultChecked />
```
