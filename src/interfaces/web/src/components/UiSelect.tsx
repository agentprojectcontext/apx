import type { ElementType, ReactNode } from "react";
import { cn } from "../lib/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export interface UiSelectOption {
  value: string;
  label: string;
  icon?: ElementType;
  /** Pre-rendered leading element, for anything that is not a lucide glyph —
   *  an agent's blob avatar, a channel logo. Rendered as-is, before the label,
   *  in both the trigger and the list. Wins over `icon` when both are given. */
  adornment?: ReactNode;
  description?: string;
  disabled?: boolean;
}

// Thin, app-friendly wrapper over the base-ui Select primitive so call sites
// can pass a simple { value, onChange, options } API instead of the compound
// parts. Use this everywhere instead of a native <select>.
export function UiSelect({
  value,
  onChange,
  options,
  placeholder = "— elegir —",
  disabled,
  className,
  showIcon = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: UiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  showIcon?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange((v as string) ?? "")} disabled={disabled}>
      <SelectTrigger className={cn("h-9 w-full", className)}>
        <SelectValue placeholder={placeholder}>
          {(val) => {
            const opt = options.find((o) => o.value === val);
            const Icon = showIcon && !opt?.adornment ? opt?.icon : undefined;
            return (
              <span className="flex min-w-0 items-center gap-1.5">
                {opt?.adornment ?? (Icon ? <Icon className="size-3.5 shrink-0" /> : null)}
                <span className="truncate">{opt?.label ?? (val as string)}</span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      {/* side=bottom + alignItemWithTrigger=false → dropdown sits BELOW the
          trigger (not overlapping it). p-1.5 gives breathing room. */}
      <SelectContent
        side="bottom"
        sideOffset={6}
        align="start"
        alignItemWithTrigger={false}
        className="w-[var(--anchor-width)] p-1.5"
      >
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              <span className="flex min-w-0 items-center gap-2">
                {o.adornment ?? (Icon ? <Icon className="size-4 shrink-0 text-muted-fg" /> : null)}
                {o.description ? (
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{o.label}</span>
                    <span className="truncate text-[11px] text-muted-fg">{o.description}</span>
                  </span>
                ) : (
                  <span className="truncate">{o.label}</span>
                )}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
