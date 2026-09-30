import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cx } from "../cx";

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Small counter after the label. */
  count?: number;
  /** Panel content rendered when this tab is selected. */
  content?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** underline = page sections (Chat · Tasks · Board); pill = compact filters inside a panel. */
  variant?: "underline" | "pill";
  className?: string;
}

/** Section tabs, e.g. a project's Chat · Tasks · Board · Routines · Files. */
export function Tabs({ items, value, defaultValue, onValueChange, variant = "underline", className }: TabsProps) {
  return (
    <BaseTabs.Root
      className={cx("apx-tabs", `apx-tabs--${variant}`, className)}
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={(v) => onValueChange?.(String(v))}
    >
      <BaseTabs.List className="apx-tabs__list">
        {items.map((t) => (
          <BaseTabs.Tab key={t.value} value={t.value} disabled={t.disabled} className="apx-tabs__tab">
            {t.icon}
            {t.label}
            {t.count != null && <span className="apx-tabs__count">{t.count}</span>}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {items.map((t) =>
        t.content != null ? (
          <BaseTabs.Panel key={t.value} value={t.value} className="apx-tabs__panel">
            {t.content}
          </BaseTabs.Panel>
        ) : null,
      )}
    </BaseTabs.Root>
  );
}
