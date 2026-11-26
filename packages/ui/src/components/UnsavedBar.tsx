import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../cx";
import { Button } from "./Button";

export interface UnsavedBarProps {
  /** The draft differs from what is saved: the bar shows. */
  dirty: boolean;
  /** Saving is under way: Save shows a spinner and both buttons wait. */
  saving?: boolean;
  /** Shown in place of `unsavedLabel` when the last save failed (the changes stay). */
  error?: ReactNode;
  /** Shown as a quiet status while nothing is unsaved, right after a save. Leave it out to hide the bar then. */
  savedLabel?: ReactNode;
  /** Save is blocked (a required field is empty); the changes still show as unsaved. */
  saveDisabled?: boolean;
  unsavedLabel: ReactNode;
  discardLabel: ReactNode;
  saveLabel: ReactNode;
  onDiscard(): void;
  /** Leave it out inside a `<form>`: Save then submits the form (and its own checks run). */
  onSave?(): void;
  /** Cmd/Ctrl+S saves while the bar shows. On by default. */
  shortcut?: boolean;
  className?: string;
}

/**
 * The bottom of a draft that saves with a button: hidden while nothing changed; with changes, "You have unsaved
 * changes" with Discard and Save, kept at the bottom of the scrolling pane.
 */
export function UnsavedBar({
  dirty,
  saving = false,
  error,
  savedLabel,
  saveDisabled = false,
  unsavedLabel,
  discardLabel,
  saveLabel,
  onDiscard,
  onSave,
  shortcut = true,
  className,
}: UnsavedBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const save = useRef<() => void>(undefined);
  save.current = () => {
    if (onSave) onSave();
    else ref.current?.closest("form")?.requestSubmit();
  };
  const armed = shortcut && dirty && !saving && !saveDisabled;
  useEffect(() => {
    if (!armed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      event.preventDefault();
      save.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed]);
  if (!dirty && !savedLabel) return null;
  return (
    <div ref={ref} className={cx("apx-unsaved", error ? "apx-unsaved--error" : undefined, className)}>
      {dirty ? (
        <>
          <span className="apx-unsaved__text" role={error ? "alert" : undefined}>
            {error || unsavedLabel}
          </span>
          <span className="apx-unsaved__actions">
            <Button variant="ghost" disabled={saving} onClick={onDiscard}>
              {discardLabel}
            </Button>
            <Button
              type={onSave ? "button" : "submit"}
              loading={saving}
              disabled={saveDisabled}
              onClick={onSave ? () => onSave() : undefined}
            >
              {saveLabel}
            </Button>
          </span>
        </>
      ) : (
        <span className="apx-unsaved__text" role="status">
          {savedLabel}
        </span>
      )}
    </div>
  );
}
