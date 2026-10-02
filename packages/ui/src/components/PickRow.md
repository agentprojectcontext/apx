---
category: Layout
---
# PickRow

A row of a MasterDetail list: optional leading icon/tile/avatar, a title (mono for ids), one line of description,
trailing chips and a status dot. `selected` fills it; `muted` fades it (off, overridden, silenced).

```tsx
<PickRow mono title="playwright" description="6 tools" trailing={<Tag>stdio</Tag>} dot="on" selected />
```
