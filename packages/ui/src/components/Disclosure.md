---
category: Content
---
# Disclosure

A bordered row that opens to show what is inside it, as Claude's plugin page lists its connectors: a chevron, an
optional icon, a title with a muted line under it and, on the right, a state or one action. Stack them with a gap;
`DisclosureFacts` lays out label and value lines in its body. Its CSS is `@apx/ui/disclosure.css`, outside
`styles.css` (only screens that load late use it): import it where it is used.

```tsx
<Disclosure icon={<Icons.Plug size={13} />} title="HubSpot" description="Connection" trailing={<Badge dot>Connected</Badge>}>
  <DisclosureFacts rows={[["Address", "api.hubapi.com"], ["Sign-in", "A key of yours"], ["Tools", "5"]]} />
</Disclosure>
```
