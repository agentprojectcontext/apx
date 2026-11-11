---
category: Layout
---
# PickRow

A row of a MasterDetail list: optional leading icon/tile/avatar, a title (mono for ids), one line of description,
trailing chips and a status dot (`on` running, `idle` a ring for ready but not running, `off`, `error`, `warning`).
`selected` fills it; `muted` fades it (off, overridden, silenced). `dotLabel` says what the dot means on hover and to
screen readers: give it whenever the dot's states are not obvious (a filled dot and a ring are both green).

```tsx
<PickRow mono title="playwright" description="6 tools" trailing={<Tag>stdio</Tag>} dot="on" dotLabel="Running" selected />
```
