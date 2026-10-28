---
category: Display
---
# RunBars

Recent runs of an automation as a row of bars, oldest at the left: full green when it ran, short gray when it stopped
early (a check said no, no tokens spent), red when it failed, blue while it runs. `label` names the row; each bar's
`label` says when it ran and how it went (hover and screen readers).

- `size="sm"` (6px bars) in list rows; `lg` (9px) above a list of runs.
- With `onSelect` each bar is a button and `selected` outlines the open one.

```tsx
<RunBars
  label="Last runs"
  runs={[
    { id: "e1", state: "ran", label: "Mon 18:40 · Ran" },
    { id: "e2", state: "cut", label: "Mon 19:02 · Stopped at a check" },
    { id: "e3", state: "failed", label: "Tue 08:12 · Failed" },
  ]}
/>
```

Its styles ship apart, in `@apx/ui/flow.css`: import it in the lazy screen that uses it.
