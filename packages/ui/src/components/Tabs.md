---
category: Navigation
---
# Tabs

Section tabs from an `items` array (`{ value, label, icon, count, content }`).

- `underline` — page sections, e.g. a project's Chat · Tasks · Board · Routines · Files.
- `pill` — compact filters inside a panel; same track and raised active tab as SegmentedControl.
- 2–4 short, mutually exclusive options in a toolbar → SegmentedControl.

```tsx
<Tabs items={[{ value: "chat", label: "Chat" }, { value: "tasks", label: "Tasks", count: 12 }, { value: "board", label: "Board" }]} />
```
