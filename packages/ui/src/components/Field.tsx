import { type ReactNode, useId } from "react";
import { cx } from "../cx";

export interface FieldProps {
  label: ReactNode;
  /** Muted line under the control. */
  hint?: ReactNode;
  /** Replaces the hint in red. */
  error?: ReactNode;
  /** The control; gets `id` so the label points at it when it is a function. */
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
}

/** A labelled form row (label on top, control, hint): the building block of dialogs and forms. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cx("apx-formfield", error ? "is-invalid" : undefined, className)}>
      <label className="apx-formfield__label" htmlFor={typeof children === "function" ? id : undefined}>
        {label}
      </label>
      {typeof children === "function" ? children(id) : children}
      {error ? (
        <span className="apx-formfield__error">{error}</span>
      ) : (
        hint && <span className="apx-formfield__hint">{hint}</span>
      )}
    </div>
  );
}
