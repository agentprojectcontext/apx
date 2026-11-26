---
category: Forms
---
# TagInput

Free tags as chips inside a field: Enter or comma adds, Backspace on an empty box removes the last, duplicates are
ignored (case-insensitive), at most `max` (12). With `addLabel`, an add button shows while something is typed, for people
who don't know Enter adds.

```tsx
<TagInput label="Tags" value={tags} onValueChange={setTags} placeholder="Client, urgent…" addLabel="Add" />
```
