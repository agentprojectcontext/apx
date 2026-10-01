---
category: Navigation
---
# BrowserTabs

Tab strip of the browser side panel. Each tab: a dot for who holds it (`holder`: `agent` warning, `handoff` pulsing warning, `user` brand, `idle` subtle), the title (url as tooltip) and an optional close button.

- Controlled: `value` + `onValueChange`. `onClose` shows the per-tab ✕; `onNew` adds a trailing "+".
- `newLabel` / `closeLabel` name the icon buttons (English by default; pass translations).
- Scrolls horizontally when tabs overflow; each tab is at most 180px.

```tsx
<BrowserTabs value="t1" onValueChange={() => {}} tabs={[
  { id: "t1", title: "Sign in", url: "https://social.example/login", holder: "agent" },
  { id: "t2", title: "Docs", holder: "idle" },
]} />
```
