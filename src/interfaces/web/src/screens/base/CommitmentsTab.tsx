import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Commitments, type CommitmentState } from "../../lib/api/commitments";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Dialog, Empty, Field, Input, Loading } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useProjects } from "../../hooks/useProjects";
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

  // Capturing a promise by hand matters even though the agent captures them
  // from conversation: the moment you remember one is rarely the moment you
  // are talking to it.
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [due, setDue] = useState("");
  const [target, setTarget] = useState(pid ?? "");
  const [busy, setBusy] = useState(false);
  const { projects } = useProjects();

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

  const resetForm = () => { setWho(""); setWhat(""); setDue(""); setTarget(pid ?? ""); };

  const create = async () => {
    const projectId = pid ?? target;
    if (!who.trim() || !what.trim() || !projectId) return;
    setBusy(true);
    try {
      await Commitments.add(String(projectId), {
        counterparty: who.trim(),
        body: what.trim(),
        // A date is optional here even though it is the useful part — refusing
        // to record "I promised Ana the quote, no date yet" would mean the
        // promise goes unrecorded, which is strictly worse.
        due: due ? new Date(due).toISOString() : null,
      });
      await paged.mutate();
      setAdding(false);
      resetForm();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      fullHeight
      title={t("project.commitments.title")}
      description={t("project.commitments.subtitle")}
      action={
        <div className="flex items-center gap-1">
          {(["open", "kept", "missed", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>
              {t(`project.commitments.state.${s}`)}
            </Button>
          ))}
          <Button size="sm" variant="primary" className="ml-2" onClick={() => setAdding(true)}>
            <Plus size={14} /> {t("project.commitments.add")}
          </Button>
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

      <Dialog
        open={adding}
        onClose={() => { setAdding(false); resetForm(); }}
        title={t("project.commitments.add_title")}
        description={t("project.commitments.add_hint")}
        footer={
          <>
            <Button onClick={() => { setAdding(false); resetForm(); }}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!who.trim() || !what.trim() || !(pid ?? target)}
              onClick={create}
            >
              {t("project.commitments.add")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 p-5">
          {/* Counterparty first — it is what makes this a commitment and not a
              task, so the form asks for it before anything else. */}
          <Field label={t("project.commitments.field_who")} hint={t("project.commitments.field_who_hint")}>
            <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Ana" autoFocus />
          </Field>
          <Field label={t("project.commitments.field_what")}>
            <Input
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder={t("project.commitments.field_what_ph")}
              onKeyDown={(e) => { if (e.key === "Enter" && who.trim() && what.trim()) create(); }}
            />
          </Field>
          <Field label={t("project.commitments.field_due")} hint={t("project.commitments.field_due_hint")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          {!pid ? (
            <Field label={t("project.commitments.field_project")}>
              <UiSelect
                value={String(target)}
                onChange={setTarget}
                options={projects.map((p) => ({ value: String(p.id), label: p.name || p.path }))}
              />
            </Field>
          ) : null}
        </div>
      </Dialog>
    </Section>
  );
}
