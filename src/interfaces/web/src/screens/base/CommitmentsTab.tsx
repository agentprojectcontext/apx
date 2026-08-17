import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Commitments, type CommitmentState } from "../../lib/api/commitments";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Empty, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

/**
 * Commitments — what was promised, to whom, by when.
 *
 * Sits next to Tasks rather than inside it. The two answer different
 * questions: a task is work, a commitment is someone waiting. Overdue is the
 * default filter for exactly that reason — the expensive failure here is
 * social, and it is silent unless something surfaces it.
 *
 * `pid` omitted = every project, which is the view that matches how promises
 * are actually made.
 */
export function CommitmentsTab({ pid }: { pid?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<CommitmentState | "all">("open");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const paged = usePagedQuery({
    key: `/api/commitments?pid=${pid ?? "all"}&state=${state}&overdue=${overdueOnly}`,
    fetchPage: (limit, offset) =>
      pid
        ? Commitments.listPage(pid, { state, overdue: overdueOnly, limit, offset })
        : Commitments.globalPage({ state, overdue: overdueOnly, limit, offset }),
    resetKey: `${pid ?? "all"}|${state}|${overdueOnly}`,
  });

  const close = async (
    projectId: string,
    id: string,
    how: "kept" | "missed",
  ) => {
    try {
      await Commitments[how](projectId, id);
      await paged.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const isOverdue = (c: { state: string; due: string | null }) =>
    c.state === "open" && !!c.due && c.due < new Date().toISOString();

  return (
    <Section
      fullHeight
      title={t("project.commitments.title")}
      description={t("project.commitments.subtitle")}
      action={
        <div className="flex gap-1">
          {(["open", "kept", "missed", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>
              {t(`project.commitments.state.${s}`)}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-3">
        <Button
          size="sm"
          variant={overdueOnly ? "primary" : "ghost"}
          onClick={() => setOverdueOnly((v) => !v)}
        >
          {t("project.commitments.overdue_only")}
        </Button>
      </div>

      {paged.isLoading && <Loading />}
      {!paged.isLoading && paged.total === 0 && <Empty>{t("project.commitments.empty")}</Empty>}

      <PagedList paged={paged} fullHeight>
        <ul className="space-y-2 text-sm" data-testid="commitments-list">
          {paged.items.map((c) => {
            const projectId = String(
              (c as { project_id?: string | number }).project_id ?? pid ?? "",
            );
            const projectName = (c as { project_name?: string }).project_name;
            return (
              <li
                key={`${projectId}-${c.id}`}
                className={`flex items-start gap-3 rounded-md border px-3 py-2 ${
                  isOverdue(c) ? "border-red-500/40 bg-red-500/5" : "border-border bg-muted/30"
                }`}
              >
                {projectName ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/p/${projectId}/commitments`)}
                    title={t("project.global_tasks.go_project")}
                  >
                    <Badge tone="info">{projectName.split("/").pop() || projectId}</Badge>
                  </button>
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {/* The counterparty leads. "Who is waiting" is the whole
                        reason this is not a task. */}
                    <span className="font-medium">{c.counterparty}</span>
                    <span className="opacity-80">— {c.body}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                    {c.due ? (
                      <span className={isOverdue(c) ? "font-medium text-red-500" : ""}>
                        {isOverdue(c) ? t("project.commitments.overdue") : t("project.global_tasks.due")}{" "}
                        {c.due.slice(0, 10)}
                      </span>
                    ) : (
                      <span className="opacity-60">{t("project.commitments.no_date")}</span>
                    )}
                    {c.origin_channel ? <span>· {c.origin_channel}</span> : null}
                    {c.renegotiated_count ? (
                      <Badge tone="warning">
                        {t("project.commitments.moved")} ×{c.renegotiated_count}
                      </Badge>
                    ) : null}
                    {c.state !== "open" ? <Badge>{t(`project.commitments.state.${c.state}`)}</Badge> : null}
                  </div>
                </div>

                {c.state === "open" && projectId ? (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => close(projectId, c.id, "kept")}>
                      {t("project.commitments.mark_kept")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => close(projectId, c.id, "missed")}>
                      {t("project.commitments.mark_missed")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </PagedList>
    </Section>
  );
}
