import { type ReactNode, useState } from "react";
import { cx } from "../cx";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: "sm" | "md";
  /** Accessible name for the group. */
  label?: string;
  className?: string;
}

/** 2–4 mutually exclusive options in one pill: Light/Dark, Auto/Ask/Plan, list/board. */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onValueChange,
  size = "md",
  label,
  className,
}: SegmentedControlProps) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const current = value ?? inner;
  return (
    <div role="radiogroup" aria-label={label} className={cx("apx-segmented", `apx-segmented--${size}`, className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={current === o.value}
          className={cx("apx-segmented__item", current === o.value && "is-selected")}
          onClick={() => {
            setInner(o.value);
            onValueChange?.(o.value);
          }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
