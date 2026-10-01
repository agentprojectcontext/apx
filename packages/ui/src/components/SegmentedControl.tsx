import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
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
    <RadioGroup
      value={current}
      onValueChange={(v: string) => {
        setInner(v);
        onValueChange?.(v);
      }}
      aria-label={label}
      className={cx("apx-segmented", `apx-segmented--${size}`, className)}
    >
      {options.map((o) => (
        <Radio.Root
          key={o.value}
          value={o.value}
          nativeButton
          render={<button type="button" />}
          className={cx("apx-segmented__item", current === o.value && "is-selected")}
        >
          {o.icon}
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
