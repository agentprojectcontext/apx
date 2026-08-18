import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from "./ui/dropdown-menu";
import { t } from "../i18n";

/**
 * The per-row action menu: one "⋯" at the end of the line.
 *
 * List rows carry three or four verbs (edit, close, discard, reopen) and
 * painting them all as buttons costs the width the row needs for the things
 * you actually read — title, who it is assigned to, when it is due. Behind a
 * kebab they cost 24px and stay in the same place on every list.
 *
 * Items are plain <DropdownMenuItem>s supplied by the caller; put the
 * destructive one last with variant="destructive".
 */
export function RowMenu({
  children,
  label,
  testId,
}: {
  children: ReactNode;
  /** Accessible name — defaults to a generic "actions". */
  label?: string;
  testId?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label ?? t("common.actions")}
        data-testid={testId}
        // stopPropagation: rows are clickable (they open the detail panel) and
        // opening the menu is not selecting the row.
        onClick={(e) => e.stopPropagation()}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-fg transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground"
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
