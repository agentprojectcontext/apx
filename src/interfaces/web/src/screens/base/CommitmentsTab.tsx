import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Commitments, type CommitmentEntry, type CommitmentState } from "../../lib/api/commitments";
import { useSearchParams } from "react-router-dom";
import { Section } from "../../components/Section";
import { Pager, usePagedQuery } from "../../components/Pager";
import { Button, Empty, FilterChips, Loading } from "../../components/ui";
import { CommitmentList } from "../../components/commitments/CommitmentList";
import { CommitmentDetail } from "../../components/commitments/CommitmentDetail";
import { CommitmentFormDialog } from "../../components/commitments/CommitmentFormDialog";
import { useProjects } from "../../hooks/useProjects";
import { t } from "../../i18n";

/**
 * Commitments — what was promised, to whom, by when. Master-detail, same frame
 * as Tasks and Routines.
 *
 * Sits next to Tasks rather than inside it. The two answer different
 * questions: a task is work, a commitment is someone waiting. Overdue is a
 * one-click filter for exactly that reason — the expensive failure here is
 * social, and it is silent unless something surfaces it.
 *
 * `pid` omitted = every project, which is the view that matches how promises
 * are actually made.
 */
export function CommitmentsTab({ pid }: { pid?: string }) {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<CommitmentState | "all">("open");
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Capturing a promise by hand matters even though the agent captures them
  // from conversation: the moment you remember one is rarely the moment you
  // are talking to it.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ pid: string; commitment: CommitmentEntry } | null>(null);
  const { projects } = useProjects();

  const paged = usePagedQuery({
    key: `/api/commitments?pid=${pid ?? "all"}&state=${state}&overdue=${overdueOnly}`,
    fetchPage: (limit, offset) =>
      pid
        ? Commitments.listPage(pid, { state, overdue: overdueOnly, limit, offset })
        : Commitments.globalPage({ state, overdue: overdueOnly, limit, offset }),
    resetKey: `${pid ?? "all"}|${state}|${overdueOnly}`,
    swr: { dedupingInterval: 0, revalidateOnFocus: true },
  });

  const rowPid = (c: CommitmentEntry) =>
    pid ?? String((c as { project_id?: string | number }).project_id ?? "");
  const selectedId = params.get("c_id");
  const selected = paged.items.find((x) => x.id === selectedId) || null;

  const select = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("c_id", id); else next.delete("c_id");
      return next;
    }, { replace: true });

  // One promise is always open, and a stale ?c_id heals itself.
  useEffect(() => {
    if (paged.items.length === 0) return;
    if (selectedId && paged.items.some((x) => x.id === selectedId)) return;
    select(paged.items[0].id);
  }, [paged.items, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section
      fullHeight
      title={t("project.commitments.title")}
      description={t("project.commitments.subtitle")}
      action={
        <Button size="sm" variant="primary" data-testid="commitment-new" onClick={() => setAdding(true)}>
          <Plus size={14} /> {t("project.commitments.add")}
        </Button>
      }
      filters={
        <>
          <FilterChips
            value={state}
            onChange={setState}
            testIdPrefix="commitment-filter"
            label={t("project.commitments.title")}
            options={(["open", "kept", "missed", "dropped", "all"] as const).map((s) => ({
              value: s, label: t(`project.commitments.state.${s}`),
            }))}
          />
          <Button
            size="sm"
            className="ml-2"
            variant={overdueOnly ? "primary" : "ghost"}
            onClick={() => setOverdueOnly((v) => !v)}
          >
            {t("project.commitments.overdue_only")}
          </Button>
        </>
      }
    >
      {paged.isLoading && <Loading />}
      {!paged.isLoading && paged.total === 0 && <Empty>{t("project.commitments.empty")}</Empty>}

      {paged.items.length > 0 && (
        <div className={"flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border lg:flex-row"}>
          <CommitmentList
            className={"max-h-64 shrink-0 border-b border-border lg:h-full lg:max-h-none lg:w-[280px] lg:border-b-0 lg:border-r"}
            commitments={paged.items}
            pid={rowPid}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onEdit={(c) => setEditing({ pid: rowPid(c), commitment: c })}
            onChanged={() => paged.mutate()}
            footer={
              <Pager
                page={paged.page}
                pageCount={paged.pageCount}
                total={paged.total}
                start={paged.start}
                end={paged.end}
                pageSize={paged.pageSize}
                onPage={paged.setPage}
                onPageSize={paged.setPageSize}
              />
            }
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selected ? (
              <CommitmentDetail
                key={`${rowPid(selected)}-${selected.id}`}
                commitment={selected}
                pid={rowPid(selected)}
                projectName={pid ? undefined : (selected as { project_name?: string }).project_name}
                onEdit={() => setEditing({ pid: rowPid(selected), commitment: selected })}
                onChanged={() => paged.mutate()}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <p className="text-sm text-muted-fg">{t("project.commitments.detail_empty")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <CommitmentFormDialog
        open={adding || !!editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        fixedPid={pid}
        projects={projects}
        editing={editing}
        onSaved={() => paged.mutate()}
      />
    </Section>
  );
}
