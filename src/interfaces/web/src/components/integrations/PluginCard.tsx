import type { ReactNode } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tip } from "../ui";

// Collapsible card shell for one integration plugin. Ported from PandaProject's
// PluginCard but restyled onto APX's design tokens (border/card/muted).
export function PluginCard({
  icon,
  title,
  description,
  badges,
  rightContent,
  hasTools,
  expanded,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  rightContent?: ReactNode;
  hasTools?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/40"
        onClick={onToggle}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {badges}
            {hasTools && (
              <Tip content="Esta integración expone tools para los agentes">
                <span>
                  <Wrench className="h-3 w-3 text-muted-foreground" />
                </span>
              </Tip>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {rightContent}
          <ChevronRight
            className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-90")}
          />
        </div>
      </button>
      {expanded && children && <div className="border-t border-border">{children}</div>}
    </div>
  );
}
