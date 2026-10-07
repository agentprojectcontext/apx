---
category: Forms
---
# Select

One choice from a list, as a field-looking trigger and a menu-looking list (Base UI Select: keyboard, typeahead).
Options take an `icon` (avatar, tile, dot), a muted `hint`, a `description` (a line under the label in the list, saying
what the choice does), a `group` (listed under a label, in first-seen order), `trailing` marks at the end of the row
in the list (a contact's channels) and `keywords` a searchable list also finds it by.
`label` is the accessible name; wrap it in `Field` for a visible one.

```tsx
<Select label="Agent" value="roby" onValueChange={setAgent} options={[
  { value: "roby", label: "Roby", icon: <AgentAvatar name="Roby" size={16} />, group: "Global" },
  { value: "acme-dev", label: "Dev", hint: "Acme", group: "Acme" },
]} />
```
