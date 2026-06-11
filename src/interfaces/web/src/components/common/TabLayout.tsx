// Shared two-column shell for the sectioned-nav screens (per-project + settings).
// Left: the collapsible TabNav. Right: a thin toolbar that carries the
// collapse toggle (and optional page actions) followed by the routed content.
// The page title/subtitle live in the top breadcrumb now, not here.
import { type ReactNode } from "react";
import { TabNav, type TabSection } from "./TabNav";
import { cn } from "../../lib/cn";
import { useRegisterNavCollapse } from "../../hooks/useNavCollapseCtx";

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
  useRegisterNavCollapse(collapsed, onToggleCollapse);

  return (
    <div className="flex h-full">
      <TabNav sections={sections} active={active} onChange={onChange} collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {actions ? (
          <div className="flex shrink-0 items-center justify-end gap-2 px-6 pt-3">
            {actions}
          </div>
        ) : null}
        <div className={cn("flex-1 min-h-0 overflow-y-auto", contentClassName)} data-testid={testId}>
          {children}
        </div>
      </div>
    </div>
  );
}
