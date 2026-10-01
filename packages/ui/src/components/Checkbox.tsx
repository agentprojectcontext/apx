import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cx } from "../cx";

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Mixed state for "select all" headers. */
  indeterminate?: boolean;
  disabled?: boolean;
  label?: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** Checkbox for multi-select lists and forms. */
export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  indeterminate,
  disabled,
  label,
  description,
  className,
}: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("apx-choice", "apx-choice--start", disabled && "is-disabled", className)}>
      <BaseCheckbox.Root
        id={id}
        className="apx-checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        indeterminate={indeterminate}
        onCheckedChange={(v) => onCheckedChange?.(v)}
        disabled={disabled}
      >
        <BaseCheckbox.Indicator className="apx-checkbox__indicator">
          {indeterminate ? <Minus size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label && (
        <span className="apx-choice__text">
          <span className="apx-choice__label">{label}</span>
          {description && <span className="apx-choice__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}
