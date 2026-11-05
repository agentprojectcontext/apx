---
category: Display
---
# Meter

Bar for an amount out of a whole: RAM, disk, a quota. `value` alone tones itself by share (brand, warning past 80%,
danger past 92%); `segments` stack parts with their own tone (`brand`, `violet`, `info`, `warning`, `danger`,
`muted`), and `legend` labels them under the bar. `size="sm"` is the 4px bar for dense rows. `shape="ring"` draws
one amount as a small circle (14px `sm`, 16px `md`) to sit beside text, like how full a chat's context is.

```tsx
<Meter label="Disk" value={412} max={500} valueText="88 GB free" />
<Meter shape="ring" size="sm" label="Context used" value={82} max={128} />
<Meter
  label="Memory"
  max={16}
  legend
  segments={[
    { value: 2.1, tone: "brand", label: "APX 2.1 GB" },
    { value: 1.5, tone: "violet", label: "Linux VM 1.5 GB" },
    { value: 7.4, tone: "muted", label: "Other apps 7.4 GB" },
  ]}
/>
```
