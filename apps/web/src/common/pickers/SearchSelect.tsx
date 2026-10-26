import "../../styles/searchselect.css";
import { Icons, type SelectOption, useApx } from "@apx/ui";
import { Combobox } from "@base-ui/react/combobox";
import { type ReactElement, useMemo, useRef } from "react";

export interface SearchSelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  /** Accessible name of the field (there is no visible label; wrap it in Field for one). */
  label: string;
  /** Placeholder of the search box inside the list. */
  searchPlaceholder: string;
  /** Shown when nothing matches the search. */
  emptyLabel: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  /** Opens the list from this element (a button) instead of the field: a picker that acts, holding no value. */
  trigger?: ReactElement;
}

type Group = { value: string; items: SelectOption[] };

/** Lowercase without accents, so "sao" finds "São Paulo". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Every word of the query appears in the label, hint, group or keywords. */
function matches(o: SelectOption, query: string): boolean {
  const hay = fold(`${o.label} ${o.hint ?? ""} ${o.group ?? ""} ${o.keywords ?? ""} ${o.value}`);
  return fold(query)
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/** A Select for lists that grow (agents, projects, contacts, time zones, languages): the same field, with a search box
 * at the top of the list. Kept out of @apx/ui so the combobox loads with the screens that pick, not the first one. */
export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  searchPlaceholder,
  emptyLabel,
  size = "md",
  disabled,
  className,
  trigger,
}: SearchSelectProps) {
  const { portalRef } = useApx();
  const search = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value) ?? null;
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    for (const o of options) {
      const g = o.group ?? "";
      const last = out.find((x) => x.value === g);
      if (last) last.items.push(o);
      else out.push({ value: g, items: [o] });
    }
    return out;
  }, [options]);
  const item = (o: SelectOption) => (
    <Combobox.Item key={o.value} value={o} disabled={o.disabled} className="apx-menu__item apx-select__item">
      {o.icon && <span className="apx-select__icon">{o.icon}</span>}
      <span className="apx-menu__text">{o.label}</span>
      {o.hint && <span className="apx-select__hint">{o.hint}</span>}
      {o.trailing && <span className="apx-select__trailing">{o.trailing}</span>}
      <Combobox.ItemIndicator className="apx-select__check">
        <Icons.Check size={14} />
      </Combobox.ItemIndicator>
    </Combobox.Item>
  );
  return (
    <Combobox.Root
      items={groups}
      value={current}
      onValueChange={(o: SelectOption | null) => onValueChange(o?.value ?? null)}
      isItemEqualToValue={(a: SelectOption, b: SelectOption) => a.value === b.value}
      filter={(o: SelectOption, q: string) => matches(o, q)}
      autoHighlight
      disabled={disabled}
    >
      {trigger ? (
        <Combobox.Trigger render={trigger} />
      ) : (
        <Combobox.Trigger
          aria-label={label}
          className={["apx-field", `apx-field--${size}`, "apx-select", disabled && "is-disabled", className]
            .filter(Boolean)
            .join(" ")}
        >
          {current?.icon && <span className="apx-select__icon">{current.icon}</span>}
          <span className={current ? "apx-select__value" : "apx-select__value is-placeholder"}>
            {current?.label ?? placeholder}
          </span>
          <Combobox.Icon className="apx-select__chevron">
            <Icons.ChevronDown size={14} />
          </Combobox.Icon>
        </Combobox.Trigger>
      )}
      <Combobox.Portal container={portalRef}>
        <Combobox.Positioner sideOffset={6} align="end" className="apx-select__positioner">
          {/* Typing goes to the search however the list opened: on the list itself, letters would jump between items. */}
          <Combobox.Popup className="apx-menu apx-searchselect__popup" aria-label={label} initialFocus={search}>
            <div className="apx-searchselect__search">
              <Icons.Search size={14} />
              <Combobox.Input ref={search} className="apx-searchselect__input" placeholder={searchPlaceholder} />
            </div>
            <Combobox.Empty className="apx-searchselect__empty">{emptyLabel}</Combobox.Empty>
            <Combobox.List className="apx-searchselect__list">
              {(g: Group) =>
                g.value ? (
                  <Combobox.Group key={g.value} items={g.items}>
                    <Combobox.GroupLabel className="apx-menu__label">{g.value}</Combobox.GroupLabel>
                    <Combobox.Collection>{item}</Combobox.Collection>
                  </Combobox.Group>
                ) : (
                  <Combobox.Group key="~" items={g.items}>
                    <Combobox.Collection>{item}</Combobox.Collection>
                  </Combobox.Group>
                )
              }
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
