import type { ReactNode } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Commitments, type CommitmentEntry } from "../../lib/api/commitments";
import { RowMenu } from "../RowMenu";
import { DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { useToast } from "../Toast";
import { CommitmentIcon, commitmentFace, commitmentTint, isOverdue } from "./commitmentState";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Left column: the promises, one compact row each — same shape as the task and
 * routine lists, because these three screens sit next to each other in the rail
 * and switching between them should not move anything.
 *
 * The counterparty is the row's title. "Who is waiting" is the whole reason
 * this is not a task.
 */
export function CommitmentList({
  commitments,
  pid,
  selectedId,
  onSelect,
  onEdit,
  onChanged,
  footer,
  className,
}: {
  commitments: CommitmentEntry[];
  pid: (c: CommitmentEntry) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (c: CommitmentEntry) => void;
  onChanged: () => void;
  footer?: ReactNode;
  /** Frame (width / borders) — the screen owns how the two panes sit. */
  className?: string;
}) {
  const toast = useToast();

  const act = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast.success(label);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  return (
    <aside className={cn("flex min-h-0 flex-col", className)}>
      <div className="shrink-0 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("project.commitments.list_title")}
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pt-0" data-testid="commitments-list">
        {commitments.map((c) => {
          const face = commitmentFace(c);
          const active = c.id === selectedId;
          const cPid = pid(c);
          const due = c.due ? String(c.due).slice(0, 10) : null;
          const project = (c as { project_name?: string }).project_name;
          return (
            <li
              key={`${cPid}-${c.id}`}
              data-testid={`commitment-${c.id}`}
              className={cn(
                "flex items-start gap-1 rounded-lg border transition-colors",
                active
                  ? "border-primary/50 bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-accent/40",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={active}
                className="min-w-0 flex-1 px-2.5 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", commitmentTint(face))}>
                    <CommitmentIcon face={face} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.counterparty}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 pl-8 text-[10px] text-muted-fg">
                  <span className="truncate">{project ? `${project.split("/").pop()} · ` : ""}{c.body}</span>
                  {due && (
                    <span className={cn("shrink-0", isOverdue(c) && "font-medium text-red-500")}>⏱ {due}</span>
                  )}
                </div>
              </button>

              <div className="pr-1 pt-2">
                <RowMenu label={t("project.commitments.row_actions")} testId={`commitment-menu-${c.id}`}>
                  <DropdownMenuItem onClick={() => onEdit(c)} data-testid={`commitment-edit-${c.id}`}>
                    <Pencil size={15} className="text-muted-fg" />
                    {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {c.state === "open" ? (
                    <>
                      <DropdownMenuItem
                        data-testid={`commitment-kept-${c.id}`}
                        onClick={() => act(() => Commitments.kept(cPid, c.id), t("project.commitments.mark_kept"))}
                      >
                        <Check size={15} className="text-emerald-500" />
                        {t("project.commitments.mark_kept")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`commitment-missed-${c.id}`}
                        onClick={() => act(() => Commitments.missed(cPid, c.id), t("project.commitments.mark_missed"))}
                      >
                        <X size={15} className="text-red-500" />
                        {t("project.commitments.mark_missed")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  {/* Filed by mistake — deliberately not the same verb as
                      "missed", which says you failed a person who was waiting. */}
                  <DropdownMenuItem
                    variant="destructive"
                    data-testid={`commitment-drop-${c.id}`}
                    onClick={() => act(() => Commitments.drop(cPid, c.id), t("project.commitments.dropped_toast"))}
                  >
                    <Trash2 size={15} />
                    {t("project.commitments.mark_dropped")}
                  </DropdownMenuItem>
                </RowMenu>
              </div>
            </li>
          );
        })}
      </ul>
      {footer ? <div className="shrink-0 border-t border-border px-3 py-2">{footer}</div> : null}
    </aside>
  );
}
