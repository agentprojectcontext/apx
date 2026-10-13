---
category: Forms
---
# SettingRow

A settings line as in Config: title (14) and a muted description (13) on the left, the control on the right, a 1px border on top. Stack them; the first one's border separates it from the section title.

```tsx
<SettingRow title="Modo" description="Claro u oscuro en todo el panel.">
  <SegmentedControl size="sm" options={[{ value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }]} />
</SettingRow>
```

A control that needs the width, like a paragraph to write, goes under the text with `stacked`:

```tsx
<SettingRow stacked title="Sobre vos" description="Lo que tus agentes saben de vos siempre.">
  <Textarea rows={3} />
</SettingRow>
```
