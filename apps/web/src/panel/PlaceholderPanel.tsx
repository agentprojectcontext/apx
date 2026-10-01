import { EmptyState } from "@apx/ui";
import type { ReactNode } from "react";

export function PlaceholderPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="sidepanel__body">
      <EmptyState icon={icon} title={title}>
        {children}
      </EmptyState>
    </div>
  );
}
