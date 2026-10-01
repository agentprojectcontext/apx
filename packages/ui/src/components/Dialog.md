---
category: Overlays
---
# Dialog

Modal for confirmations and short forms: `title`, `description`, body `children`, `footer` actions (secondary then primary, right-aligned).

- APX never uses modals for notices or updates — use a Card/banner instead.

```tsx
<Dialog defaultOpen title="Delete routine?" description="Overnight outbound stops running. Past runs stay in the log."
  footer={<><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></>} />
```

`bare` + `size="xl"` is the settings layout (Config): no padding, the title stays for screen readers, the close button floats top-right and `children` lay out the whole popup (left nav + content). Pass the height with `style`.

```tsx
<Dialog bare size="xl" title="Configuración" open={open} onOpenChange={setOpen} style={{ height: "min(760px, 100vh - 64px)" }}>
  <nav>…</nav><div>…</div>
</Dialog>
```
