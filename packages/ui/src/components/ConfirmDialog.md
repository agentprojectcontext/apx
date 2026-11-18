---
category: Overlays
---
# ConfirmDialog

Asks before an action that removes something or changes it for good (remove a catalog, an extension, disconnect an
account): the question as its title, what goes with it as its description, then **Cancel** and the action's own word
in red. The action runs while its button spins and the dialog closes when it ends. Never "OK" or "Yes".

```tsx
{asking && (
  <ConfirmDialog
    title="Remove the claude-plugins-official catalog?"
    description="Its 273 extensions leave Explore. The ones you added stay."
    confirmLabel="Remove"
    cancelLabel="Cancel"
    onConfirm={() => client.call("extensions.catalog_remove", { id })}
    onClose={() => setAsking(false)}
  />
)}
```
