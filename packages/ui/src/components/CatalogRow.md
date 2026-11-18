---
category: Display
---
# CatalogRow

A row of a catalog, as Claude lists plugins and connectors: a 36px logo, the name with a Badge for where it comes
from, one line of what it is, a muted line (what it brings, who from) and on the right one thing: its `action` (Add,
Connect) or its `status` ("Connected" with a check, or why it waits with a warning dot). The whole row opens it.
Lay rows out in one column, or two side by side when there is room; on a narrow row the action goes under the text.
Its CSS is `@apx/ui/catalog-row.css`, outside `styles.css` (only screens that load late use it).

```tsx
<CatalogRow leading={<IntegrationIcon id="asana" name="Asana" size={36} />} title="Asana"
  badge={<Badge>Included</Badge>} description="Tasks and projects of your workspace." meta="Connection · From APX"
  action={<Button size="sm" variant="secondary">Connect</Button>} onOpen={open} />
```
