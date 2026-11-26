import { createElement as h, useState } from "react";
import { UnsavedBar } from "../dist/index.js";

const labels = { unsavedLabel: "You have unsaved changes.", discardLabel: "Discard", saveLabel: "Save changes" };

/** A one-field draft saved through `onSave`, and a form whose Save submits it (so `required` runs). */
export function UnsavedFixture() {
  const [saved, setSaved] = useState("Acme");
  const [draft, setDraft] = useState("Acme");
  const [saving, setSaving] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [release, setRelease] = useState<() => void>();
  const save = () => {
    setSaving(true);
    setError(false);
    // The save waits for "Finish save", so the test sees the saving state.
    setRelease(() => () => {
      setSaving(false);
      setRelease(undefined);
      if (failNext) {
        setFailNext(false);
        return setError(true);
      }
      setSaved(draft);
      setDone(true);
    });
  };
  const [formSaved, setFormSaved] = useState("Northwind");
  const [formDraft, setFormDraft] = useState("Northwind");
  return h(
    "section",
    {},
    h("input", {
      "aria-label": "Draft name",
      value: draft,
      onChange: (e: { currentTarget: HTMLInputElement }) => {
        setDraft(e.currentTarget.value);
        setDone(false);
      },
    }),
    h("output", { "data-testid": "saved" }, saved),
    h("button", { type: "button", onClick: () => setFailNext(true) }, "Fail next save"),
    release && h("button", { type: "button", onClick: release }, "Finish save"),
    h(UnsavedBar, {
      ...labels,
      className: "fixture-bar",
      dirty: draft !== saved,
      saving,
      error: error && "Couldn't save.",
      savedLabel: done ? "Changes saved" : undefined,
      onDiscard: () => setDraft(saved),
      onSave: save,
    }),
    h(
      "form",
      {
        "aria-label": "Form draft",
        onSubmit: (e: { preventDefault(): void }) => {
          e.preventDefault();
          setFormSaved(formDraft);
        },
      },
      h("input", {
        "aria-label": "Form name",
        required: true,
        value: formDraft,
        onChange: (e: { currentTarget: HTMLInputElement }) => setFormDraft(e.currentTarget.value),
      }),
      h(UnsavedBar, {
        ...labels,
        dirty: formDraft !== formSaved,
        onDiscard: () => setFormDraft(formSaved),
      }),
    ),
    h("output", { "data-testid": "form-saved" }, JSON.stringify(formSaved)),
  );
}
