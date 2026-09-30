---
category: Foundation
---
# ApxProvider

Root of every APX surface. Sets the **look** (`minimal` | `classic`) and **mode** (`light` | `dark`) and hosts the portal layer for menus, tooltips and dialogs.

- **Always** wrap a screen in it — every component reads `--apx-*` tokens that only exist under a provider (or an element with `data-apx-look`).
- `look="minimal"` is APX v2: warm greys, ink primary, pill controls, borderless bubbles.
- `look="classic"` is APX v1: APX green selection, bordered groups, mono metadata and uppercase role tags, 8–12px radii.
- `fill` paints `--apx-bg` and fills the parent's height — use it on the app root.
- Nest a second provider to show a region in another look/mode (e.g. a dark sidebar next to a light thread).

```tsx
<ApxProvider look="minimal" mode="light" fill>
  <Composer placeholder="Message Roby" onAttach={() => {}} />
</ApxProvider>
```
