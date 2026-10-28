---
category: Display
---
# FlowStep

A step of a Flow as a card on its canvas (230px wide): the kind as a toned tile and a small label, the step's name and
one line with the setting that tells it apart (a field path, a table key; mono unless `detailPlain`). Use it for the
editor and for the read-only canvas of a run.

- `tone`: the family of the kind — `warning` triggers, `info` steps without a model, `neutral` checks, `violet` steps
  that hand work to an agent, `brand` outputs.
- `state` (a run): `ran` green border, `failed` red, `live` blue, `skipped` dashed and faded. `order` puts the order it
  ran in on the corner; `badge` shows "ok · 0,8 s", "Didn't run".
- `selected` rings it; `muted` draws a kind that cannot be saved or run yet.
- `children` take the canvas's connection handles. `FlowStepTile` is the tile alone, for step lists and row chips
  (`size` `sm` 22px, `md` 20px, `lg` 28px; `label` names it for screen readers).

```tsx
<FlowStep
  icon={<Icons.Filter />}
  kind="Check"
  title="Only leads"
  detail="type = lead"
  state="ran"
  order={2}
  badge="ok"
/>
<FlowStepTile icon={<Icons.Zap />} tone="warning" size="lg" />
```

Its styles ship apart, in `@apx/ui/flow.css`: import it in the lazy screen that uses it.
