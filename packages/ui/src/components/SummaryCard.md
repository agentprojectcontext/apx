---
category: Content
---
# SummaryCard

What something is before deciding on it, as one quiet card: its mark, name, a quiet `meta` (a version), a `badge`
(where it comes from), one line under it and an `aside` (its state). Inside, `SummarySection` groups with a small
heading, `SummaryItem` lists what it brings (icon, bold name, muted line) and `SummaryNote` is a line to read first:
`warning` for code that runs here, `brand` for files checked, `rule` to close the card with a line above it. Label and
value lines go in a `DisclosureFacts`. `variant="soft"` is filled, for a dialog; `outline` is bordered, for a page
(there, leave `title` out: the page already shows the name). CSS in `@apx/ui/summary.css`.

```tsx
<SummaryCard icon={<IntegrationIcon id="stripe" name="Stripe" size={36} />} title="Stripe" meta="1.0.0" badge={<Badge tone="info">Official</Badge>} description="Customers, payments and subscriptions">
  <SummarySection title="What it brings">
    <SummaryItem icon={<Icons.Plug size={13} />} title="Connection with Stripe">8 tools: list customers, get a payment…</SummaryItem>
  </SummarySection>
  <SummaryNote tone="warning" icon={<Icons.Cpu size={14} />}>Runs a program on your computer. It does not start until you connect it.</SummaryNote>
</SummaryCard>
```
