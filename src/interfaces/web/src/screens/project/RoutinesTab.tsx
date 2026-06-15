import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Routines, type RoutineEntry } from "../../lib/api";
import { Button, Dialog, Empty, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { RoutineList } from "../../components/routines/RoutineList";
import { RoutineDetail } from "../../components/routines/RoutineDetail";
import { RoutineEditor } from "../../components/routines/RoutineEditor";

// Full-height master-detail (like the Chat screen): scrollable routine list on
// the left, read-only detail on the right. Selection lives in the URL (?r_id),
// editing is behind a button, delete uses the shared <Dialog>.
export function RoutinesTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/routines`, () => Routines.list(pid));
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Partial<RoutineEntry> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoutineEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = list.data || [];
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

  const toggle = async (r: RoutineEntry) => {
    try { await (r.enabled ? Routines.disable : Routines.enable)(pid, r.name); list.mutate(); }
    catch (e: any) { toast.error(e?.message || t("project.routines.toggle_error")); }
  };
  const runNow = async (r: RoutineEntry) => {
    try { await Routines.run(pid, r.name); toast.success(t("project.routines.run_success", { name: r.name })); }
    catch (e: any) { toast.error(e?.message || t("project.routines.run_error")); }
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* header (title + new) */}
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("project.routines.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-fg">{t("project.routines.subtitle")}</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setEditing({ kind: "super_agent", schedule: "every:10m", enabled: true })}>
          <Plus size={14} /> {t("project.routines.new_btn")}
        </Button>
      </div>

      {list.isLoading && <Loading />}
      {!list.isLoading && rows.length === 0 && <Empty>{t("project.routines.empty")}</Empty>}

      {rows.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-[minmax(200px,260px)_1fr] overflow-hidden rounded-xl border border-border bg-card/40">
          <RoutineList routines={rows} selectedName={selected?.name ?? null} onSelect={selectRoutine} />
          <div className="min-h-0 min-w-0 overflow-hidden">
            {selected
              ? <RoutineDetail
                  key={selected.name}
                  pid={pid}
                  routine={selected}
                  onEdit={() => setEditing({ ...selected })}
                  onRun={() => runNow(selected)}
                  onToggle={() => toggle(selected)}
                  onDelete={() => setConfirmDelete(selected)}
                />
              : <div className="flex h-full items-center justify-center p-8">
                  <p className="text-sm text-muted-fg">{t("project.routines.detail_empty")}</p>
                </div>}
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
    </div>
  );
}
