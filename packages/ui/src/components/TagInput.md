---
category: Forms
---
# TagInput

Free tags as chips inside a field: Enter or comma adds, Backspace on an empty box removes the last, duplicates are
ignored (case-insensitive), at most `max` (12).

```tsx
<TagInput label="Tags" value={tags} onValueChange={setTags} placeholder="Client, urgent…" />
```
