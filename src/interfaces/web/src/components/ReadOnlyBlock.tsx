import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { t } from "../i18n";

/** A titled, read-only, scrollable block — the detail-view stand-in for an editor textarea. */
export function ReadOnlyBlock({
  title, body, mono, empty,
}: {
  title: string;
  body: string;
  mono?: boolean;
  /** Shown when there is nothing to read; say what the field is FOR. */
  empty?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{title}</div>
      <div className={cn("max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs", mono && "font-mono")}>
        {body.trim() ? body : <span className="text-muted-fg">{empty ?? t("project.routines.block_empty")}</span>}
      </div>
    </div>
  );
}
