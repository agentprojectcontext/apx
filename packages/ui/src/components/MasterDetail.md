---
category: Layout
---
# MasterDetail

A narrow list (300px) beside the detail of the selected item. The pattern of everything that is configured: Resources
(skills, MCP, integrations, extensions), channels with their contacts, routines.

- `detail` undefined → `empty` fills the right side (an EmptyState that says what to pick).
- Below 1040px one column shows at a time: the list, or the detail with a back button (`onBack`, `backLabel`).

```tsx
<MasterDetail
  listLabel="Skills"
  list={<ul>{skills.map((s) => <PickRow key={s.name} title={s.name} />)}</ul>}
  detail={selected && <SkillDetail skill={selected} />}
  empty={<EmptyState icon={<Icons.Sparkles />}>Pick a skill.</EmptyState>}
  onBack={() => setSelected(undefined)}
  backLabel="Skills"
/>
```
