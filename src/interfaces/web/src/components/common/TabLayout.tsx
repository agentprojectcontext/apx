// Shared two-column shell for the sectioned-nav screens (per-project + settings).
// Left: the collapsible TabNav. Right: a thin toolbar that carries the
// collapse toggle (and optional page actions) followed by the routed content.
// The page title/subtitle live in the top breadcrumb now, not here.
import { type ReactNode } from "react";
import { TabNav, NavToggle, type TabSection } from "./TabNav";
import { cn } from "../../lib/cn";

interface Props {
  sections: TabSection[];
  active: string;
  onChange: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  actions?: ReactNode;
  contentClassName?: string;
  testId?: string;
  children: ReactNode;
}

export function TabLayout({
  sections,
  active,
  onChange,
  collapsed,
  onToggleCollapse,
  actions,
  contentClassName,
  testId,
  children,
}: Props) {
  return (
    <div className="flex h-full">
      <TabNav sections={sections} active={active} onChange={onChange} collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-3">
          <NavToggle collapsed={collapsed} onToggle={onToggleCollapse} />
          {actions ? <div className="flex gap-2">{actions}</div> : null}
        </div>
        <div className={cn(contentClassName)} data-testid={testId}>
          {children}
        </div>
      </div>
    </div>
  );
}
