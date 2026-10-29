---
category: Forms
---
# TemplateField

A text field where values are inserted without knowing their syntax: a Flow step's message, header or variable. Typing
a trigger (`{{`, `$` or `secret://` by default) or pressing the braces button opens the values, grouped (what arrived,
earlier steps, variables, APX's own, secrets). A chosen value is written into the text and every placeholder the
`pattern` matches reads as a badge; secrets (`secretPattern`) in the warning tone. Arrows choose, Enter or Tab writes
it, Escape closes the list.

- The text stays plain text: the badges are drawn under a transparent textarea in the same metrics, so typing,
  selecting, undo and paste work as in any field.
- Offer a group only where its values work: secrets only in fields a step resolves itself.

```tsx
<TemplateField
  value={text}
  onValueChange={setText}
  pickLabel="Insert a value"
  pattern={/\$(trigger|steps|vars|apx)(\.[\w-]+)*|secret:\/\/[\w.~/-]+/g}
  secretPattern={/^secret:/}
  groups={[
    { label: "What arrived", values: [{ insert: "$trigger.email", label: "email" }] },
    { label: "Secrets", values: [{ insert: "secret://acme_key", label: "acme_key", secret: true }] },
  ]}
/>
```
