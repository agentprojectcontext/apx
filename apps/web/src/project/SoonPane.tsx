import { EmptyState, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";

/** Honest placeholder for a screen whose API does not exist yet. Never sample data. */
export function SoonPane({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="soon">
      <EmptyState variant="dashed" size="lg" icon={icon} title={title}>
        {children}
        <span className="soon__tag">
          <Icons.Clock size={12} />
          {t("common.soon")}
        </span>
      </EmptyState>
    </div>
  );
}
