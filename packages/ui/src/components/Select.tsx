import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";

export interface SelectOption {
  value: string;
  label: string;
  /** Leading avatar or icon (an agent's blob, a project tile, a priority dot). */
  icon?: ReactNode;
  /** Muted text after the label (a project name, a count). */
  hint?: string;
  /** Options with the same group are listed under it, in the order they first appear. */
  group?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  options: readonly SelectOption[];
  /** Shown while nothing is chosen. */
  placeholder?: string;
  /** Accessible name (there is no visible label; wrap it in Field for one). */
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

/** One choice from a list, with icons and groups: agent, project, type, priority, reminder. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  size = "md",
  disabled,
  className,
}: SelectProps) {
  const { portalRef } = useApx();
  const current = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  const item = (o: SelectOption) => (
    <BaseSelect.Item key={o.value} value={o.value} disabled={o.disabled} className="apx-menu__item apx-select__item">
      {o.icon && <span className="apx-select__icon">{o.icon}</span>}
      <BaseSelect.ItemText className="apx-menu__text">{o.label}</BaseSelect.ItemText>
      {o.hint && <span className="apx-select__hint">{o.hint}</span>}
      <BaseSelect.ItemIndicator className="apx-select__check">
        <Check size={14} />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => onValueChange(v)}
      disabled={disabled}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cx("apx-field", `apx-field--${size}`, "apx-select", disabled && "is-disabled", className)}
      >
        {current?.icon && <span className="apx-select__icon">{current.icon}</span>}
        <BaseSelect.Value className={cx("apx-select__value", !current && "is-placeholder")} placeholder={placeholder}>
          {() => current?.label ?? placeholder}
        </BaseSelect.Value>
        <BaseSelect.Icon className="apx-select__chevron">
          <ChevronDown size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={portalRef}>
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="apx-select__positioner">
          <BaseSelect.Popup className="apx-menu apx-select__popup">
            {groups.map((g) =>
              g ? (
                <BaseSelect.Group key={g}>
                  <BaseSelect.GroupLabel className="apx-menu__label">{g}</BaseSelect.GroupLabel>
                  {options.filter((o) => o.group === g).map(item)}
                </BaseSelect.Group>
              ) : (
                options.filter((o) => !o.group).map(item)
              ),
            )}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
