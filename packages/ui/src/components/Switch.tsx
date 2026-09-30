import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Text next to the switch. */
  label?: ReactNode;
  /** Muted line under the label. */
  description?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/** On/off setting. Track fills with the selection color (ink in minimal, green in classic). */
export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  description,
  size = "md",
  className,
}: SwitchProps) {
  const control = (
    <BaseSwitch.Root
      className={cx("apx-switch", `apx-switch--${size}`)}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(v) => onCheckedChange?.(v)}
      disabled={disabled}
    >
      <BaseSwitch.Thumb className="apx-switch__thumb" />
    </BaseSwitch.Root>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={cx("apx-choice", disabled && "is-disabled", className)}>
      <span className="apx-choice__text">
        <span className="apx-choice__label">{label}</span>
        {description && <span className="apx-choice__desc">{description}</span>}
      </span>
      {control}
    </label>
  );
}
