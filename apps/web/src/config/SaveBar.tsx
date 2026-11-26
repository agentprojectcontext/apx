import { UnsavedBar } from "@apx/ui";
import { usePack, useT } from "../i18n/index.ts";
import "@apx/ui/unsaved-bar.css";

type Props = {
  dirty: boolean;
  saving?: boolean;
  /** The last save failed: true says so in general words, a string says what went wrong. */
  failed?: boolean | string;
  /** Says "Changes saved" until the next change. */
  saved?: boolean;
  saveDisabled?: boolean;
  onDiscard(): void;
  /** Leave it out inside a `<form>`: Save submits it. */
  onSave?(): void;
};

/** A Settings draft's unsaved changes, Discard and Save, at the bottom of the pane (UnsavedBar.md). */
export function SaveBar({ failed, saved, ...bar }: Props) {
  const t = useT();
  if (!usePack("unsaved")) return null;
  return (
    <UnsavedBar
      {...bar}
      error={failed ? (typeof failed === "string" ? failed : t("unsaved.error")) : undefined}
      savedLabel={saved ? t("unsaved.saved") : undefined}
      unsavedLabel={t("unsaved.changes")}
      discardLabel={t("unsaved.discard")}
      saveLabel={t("unsaved.save")}
    />
  );
}
