import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../cx";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md" | "lg";
  /** Icon inside the field, before the text. */
  leadingIcon?: ReactNode;
  /** Slot inside the field, after the text (a Kbd, a unit, an IconButton). */
  trailing?: ReactNode;
  /** Error state: danger border + aria-invalid. */
  invalid?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
  placeholder?: string;
  type?: string;
  name?: string;
  disabled?: boolean;
}

/** Single-line text field. Soft filled pill in minimal; bordered 8px box in classic. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", leadingIcon, trailing, invalid = false, className, disabled, ...rest },
  ref,
) {
  return (
    <label
      className={cx("apx-field", `apx-field--${size}`, invalid && "is-invalid", disabled && "is-disabled", className)}
    >
      {leadingIcon && <span className="apx-field__icon">{leadingIcon}</span>}
      <input ref={ref} className="apx-field__input" aria-invalid={invalid || undefined} disabled={disabled} {...rest} />
      {trailing && <span className="apx-field__trailing">{trailing}</span>}
    </label>
  );
});
