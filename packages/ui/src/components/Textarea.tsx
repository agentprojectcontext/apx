import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cx } from "../cx";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: TextareaHTMLAttributes<HTMLTextAreaElement>["onChange"];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

/** Multi-line text field for forms (prompts, descriptions). For the chat input use Composer. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx("apx-textarea", invalid && "is-invalid", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
