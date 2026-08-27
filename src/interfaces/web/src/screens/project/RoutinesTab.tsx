import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR, { mutate as globalMutate } from "swr";
import { MousePointerClick, Play, Plus, Repeat } from "lucide-react";
import { Routines, type RoutineEntry } from "../../lib/api";
import { Button, Dialog, Empty, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { Section } from "../../components/Section";
import { t } from "../../i18n";
import { subscribeRoutineRuns } from "../../lib/live";
import { RoutineList } from "../../components/routines/RoutineList";
import { RoutineDetail } from "../../components/routines/RoutineDetail";
import { RoutineEditor } from "../../components/routines/RoutineEditor";
import { BulkActionBar } from "../../components/common/BulkActionBar";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

// Full-height master-detail (like the Chat screen): scrollable routine list on
// the left, read-only detail on the right. Selection lives in the URL (?r_id),
// editing is behind a button, delete uses the shared <Dialog>.
export function RoutinesTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/api/projects/${pid}/routines`, () => Routines.list(pid));
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Partial<RoutineEntry> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoutineEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmRun, setConfirmRun] = useState<RoutineEntry | null>(null);
  // Optimistic only — the window between the click and the daemon's first frame.
  // The truth about what is running is `r.running`, which comes from the daemon
  // and therefore survives a refresh and shows scheduled runs too.
  const [running, setRunning] = useState<string | null>(null);
  // Multi-select run — routines are single-project and keyed by name.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkRun, setBulkRun] = useState(false);

  const rows = list.data || [];
  const isRunning = (r: RoutineEntry) => !!r.running || running === r.name;
  const selectedName = params.get("r_id");
  const selected = rows.find((r) => r.name === selectedName) || null;

  const selectRoutine = (name: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (name) next.set("r_id", name); else next.delete("r_id");
      return next;
    }, { replace: true });

  // Keep the first routine selected by default, and heal a stale ?r_id.
  useEffect(() => {
    if (rows.length === 0) return;
    if (selectedName && rows.some((r) => r.name === selectedName)) return;
    selectRoutine(rows[0].name);
  }, [rows, selectedName]); // eslint-disable-line react-hooks/exhaustive-deps

  // A run starting or ending anywhere — this tab, another device, the scheduler
  // — changes what the list should say (the running mark, then last run/status).
  // Steps in between do not: the executions pane follows those on its own.
  const refreshList = useCallback(() => { list.mutate(); }, [list]);
  useEffect(() => subscribeRoutineRuns((frame) => {
    if (String(frame.project_id) !== String(pid)) return;
    if (frame.phase === "start" || frame.phase === "end") refreshList();
  }), [pid, refreshList]);

  const wantEdit = params.get("edit") === "1";
  const canOpenEditor = wantEdit && !!selected;
  useEffect(() => {
    if (!canOpenEditor || !selected) return;
    setEditing({ ...selected });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("edit");
      return next;
    }, { replace: true });
  }, [canOpenEditor, selectedName]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCheck = (r: RoutineEntry) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(r.name)) next.delete(r.name); else next.add(r.name);
      return next;
    });
  const clearChecked = () => setChecked(new Set());
  // Prune names that have left the list (deleted/renamed) so the count stays honest.
  useEffect(() => {
    setChecked((prev) => {
      const names = new Set(rows.map((r) => r.name));
      const next = new Set([...prev].filter((n) => names.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const runBulk = async () => {
    const names = [...checked];
    if (names.length === 0) return;
    const results = await Promise.allSettled(names.map((n) => Routines.run(pid, n)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = names.length - failed;
    if (ok > 0) toast.success(t("project.routines.bulk_run_toast", { count: ok }));
    if (failed > 0) toast.error(t("project.routines.run_error"));
    clearChecked();
    await Promise.all([
      list.mutate(),
      ...names.map((n) => globalMutate(`/api/projects/${pid}/routines/${n}/runs`)),
    ]);
  };

  const toggle = async (r: RoutineEntry) => {
    try { await (r.enabled ? Routines.disable : Routines.enable)(pid, r.name); list.mutate(); }
    catch (e: any) { toast.error(e?.message || t("project.routines.toggle_error")); }
  };
  const doRun = async () => {
    if (!confirmRun) return;
    const r = confirmRun;
    setConfirmRun(null);
    setRunning(r.name);
    try {
      // The daemon answers when the run is OVER — it can be minutes. The panel
      // does not wait for that to show anything: the run announces itself on the
      // live feed within a beat, and the executions pane draws it there.
      list.mutate();
      await Routines.run(pid, r.name);
      toast.success(t("project.routines.run_success", { name: r.name }));
      // Refresh the routine list (last status) and its executions list.
      await Promise.all([
        list.mutate(),
        globalMutate(`/api/projects/${pid}/routines/${r.name}/runs`),
      ]);
    } catch (e: any) { toast.error(e?.message || t("project.routines.run_error")); }
    finally { setRunning(null); }
  };
  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await Routines.remove(pid, confirmDelete.name);
      toast.success(t("project.routines.delete_success"));
      if (selectedName === confirmDelete.name) selectRoutine(null);
      setConfirmDelete(null);
      list.mutate();
    } catch (e: any) { toast.error(e?.message || t("project.routines.delete_error")); }
    finally { setDeleting(false); }
  };

  return (
    // Same frame as every other list page. This one used to draw its own
    // header outside a card while Tasks and Commitments sat inside one, so
    // moving between them the whole page shifted.
    <Section
      fullHeight
      title={t("project.routines.title")}
      description={t("project.routines.subtitle")}
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing({ kind: "super_agent", schedule: "every:10m", enabled: true })}>
          <Plus size={14} /> {t("project.routines.new_btn")}
        </Button>
      }
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && rows.length === 0 && <Empty icon={Repeat}>{t("project.routines.empty")}</Empty>}

      {rows.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-[minmax(200px,260px)_1fr] overflow-hidden rounded-lg border border-border">
          <RoutineList routines={rows} selectedName={selected?.name ?? null} onSelect={selectRoutine} checkedNames={checked} onToggleCheck={toggleCheck} runningName={running} />
          <div className="min-h-0 min-w-0 overflow-hidden">
            {selected
              ? <RoutineDetail
                  key={selected.name}
                  pid={pid}
                  routine={selected}
                  onEdit={() => setEditing({ ...selected })}
                  onRun={() => setConfirmRun(selected)}
                  onToggle={() => toggle(selected)}
                  onDelete={() => setConfirmDelete(selected)}
                  running={isRunning(selected)}
                />
              : <Empty fill icon={MousePointerClick}>{t("project.routines.detail_empty")}</Empty>}
          </div>
        </div>
      )}

      <RoutineEditor
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); list.mutate(); }}
        pid={pid}
      />

      <Dialog
        open={!!confirmDelete}
        onClose={() => (deleting ? null : setConfirmDelete(null))}
        title={t("project.routines.delete_confirm", { name: confirmDelete?.name || "" })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={doDelete} loading={deleting}>{t("common.delete")}</Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{t("project.routines.delete_confirm_body")}</p>
      </Dialog>

      <Dialog
        open={!!confirmRun}
        onClose={() => setConfirmRun(null)}
        title={t("project.routines.run_confirm", { name: confirmRun?.name || "" })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRun(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={doRun}>{t("common.run")}</Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{t("project.routines.run_confirm_body")}</p>
      </Dialog>

      <BulkActionBar
        count={checked.size}
        countLabel={t("project.routines.bulk_selected", { count: checked.size })}
        actions={[
          { key: "run", label: t("project.routines.bulk_run"), icon: <Play size={14} />, variant: "primary", onClick: () => setBulkRun(true), testId: "routine-bulk-run" },
        ]}
        onClear={clearChecked}
        clearLabel={t("project.routines.bulk_clear")}
        testId="routine-bulk-bar"
      />
      <ConfirmDialog
        open={bulkRun}
        onClose={() => setBulkRun(false)}
        onConfirm={runBulk}
        destructive={false}
        title={t("project.routines.confirm_bulk_run_title", { count: checked.size })}
        description={t("project.routines.confirm_bulk_run_desc", { count: checked.size })}
        confirmLabel={t("common.run")}
        testId="routine-bulk-run-confirm"
      />
    </Section>
  );
}
