import { Button, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";

export type ChoiceChip = {
  value: string;
  label: ReactNode;
  /** Before the label: an app's mark. */
  icon?: ReactNode;
  /** After the label, quieter: a count. */
  aside?: ReactNode;
  /** What picking it does. */
  hint: string;
};

/**
 * One choice among a few, as bordered pills that wrap (a contact's relation, the apps in Channels); the one picked is
 * filled. `clearable` lets a second click on the picked one leave none.
 */
export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  clearable,
  className,
}: {
  label: string;
  options: ChoiceChip[];
  value: string | undefined;
  onChange(value: string | undefined): void;
  clearable?: boolean;
  className?: string;
}) {
  return (
    <fieldset aria-label={label} className={`chips${className ? ` ${className}` : ""}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tooltip key={o.value} content={o.hint}>
            <Button
              size="sm"
              variant="ghost"
              className={`chips__chip${on ? " is-on" : ""}`}
              aria-pressed={on}
              leadingIcon={o.icon}
              onClick={() => onChange(on && clearable ? undefined : o.value)}
            >
              {o.label}
              {o.aside != null && <span className="chips__aside">{o.aside}</span>}
            </Button>
          </Tooltip>
        );
      })}
    </fieldset>
  );
}
