import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cloneElement, type ReactNode, useState } from "react";
import { cx } from "../cx";
import { ContextMenu } from "./ContextMenu";
import type { MenuEntry } from "./menuEntries";

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
  /** Shows the choice without letting it change (a setting another one fixes). */
  disabled?: boolean;
  className?: string;
  /** What a right click on one option offers (none: the right click goes to what holds the control). */
  menu?: (value: string) => MenuEntry[] | undefined;
}

/** 2–4 mutually exclusive options in one pill: Light/Dark, Auto/Ask/Plan, list/board. */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onValueChange,
  size = "md",
  label,
  disabled,
  className,
  menu,
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
      disabled={disabled}
      className={cx("apx-segmented", `apx-segmented--${size}`, className)}
    >
      {options.map((o) => {
        const item = (
          <Radio.Root
            key={o.value}
            value={o.value}
            nativeButton
            render={<button type="button" />}
            className={cx("apx-segmented__item", current === o.value && "is-selected")}
          />
        );
        const items = menu?.(o.value);
        // The option itself takes the right click, so the menu opens anywhere on it.
        return items?.length ? (
          <ContextMenu key={o.value} items={items} render={item}>
            {o.icon}
            {o.label}
          </ContextMenu>
        ) : (
          cloneElement(item, undefined, o.icon, o.label)
        );
      })}
    </RadioGroup>
  );
}
