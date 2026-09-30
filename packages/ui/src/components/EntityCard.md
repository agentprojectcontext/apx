---
category: Chat
---
# EntityCard

Something the agent produced or proposes, inline in the chat — email draft, task, routine, commitment — with its actions. Use inside `<Message variant="bare">`.

- `eyebrow` + `icon` says what it is; `status` Badge top-right; `fields` for To/Subject/Due rows; body as children; `actions` = primary + secondary Buttons (`size="sm"`).
- Minimal: white sheet on a warm tray with the actions under it. Classic: single bordered panel.

```tsx
<EntityCard eyebrow="Email draft" icon={<Icons.Mail />} fields={[{ label: "To", value: "dana@northwind.co" }]}
  actions={<><Button size="sm">Send email</Button><Button size="sm" variant="secondary">Discard</Button></>}>
  <p>Hi Dana, saw Northwind opened three infra roles this month.</p>
</EntityCard>
```
