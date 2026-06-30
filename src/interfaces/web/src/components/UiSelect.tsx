import type { ElementType } from "react";
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
            const Icon = showIcon ? opt?.icon : undefined;
            return (
              <span className="flex min-w-0 items-center gap-1.5">
                {Icon && <Icon className="size-3.5 shrink-0" />}
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
                {Icon ? <Icon className="size-4 shrink-0 text-muted-fg" /> : null}
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
