---
category: Forms
---
# UnsavedBar

The bottom of a draft that saves with a button: a settings screen whose changes wait for Save (they restart
something, or several fields go together). Hidden while nothing changed. With changes it shows a muted line ("You
have unsaved changes."), Discard and Save, and stays at the bottom of the scrolling pane (`position: sticky`), so
Save is never lost under a long form. Cmd/Ctrl+S saves while it shows. While saving, Save shows a spinner; a failed
save shows `error` in place of the line, and the changes stay.

Use it only where changes wait for Save. A switch, choice or field that applies at once has no bar. A single field
with its own Save beside it, or a dialog with its footer, keeps its button.

Put it last in the draft's container, inside the scrolling pane. Inside a `<form>`, leave out `onSave`: Save submits
the form, so `required` and other checks run. `savedLabel` shows a quiet "Changes saved" after a save, until the
next change; leave it out to hide the bar then. Its CSS is `@apx/ui/unsaved-bar.css`, outside `styles.css` (it is
only on screens that load late): import it where it is used.

```tsx
<UnsavedBar
  dirty={!same(draft, saved)}
  saving={busy}
  error={failed && "Couldn't save. Try again."}
  unsavedLabel="You have unsaved changes."
  discardLabel="Discard"
  saveLabel="Save changes"
  onDiscard={() => setDraft(saved)}
  onSave={save}
/>
```
