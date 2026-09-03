import { useEffect, useState } from "react";
import { Plus, X, Zap } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Button, Dialog, Field, Input } from "../ui";
import { SelectCheckbox } from "../common/SelectCheckbox";
import { useToast } from "../Toast";
import { columnLabel, type BoardColumn } from "./columns";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Edit the board's columns.
 *
 * TWO SCOPES, ONE DIALOG, because they are two halves of one decision:
 *
 *   - the CATALOG is global. Add, rename or remove a column here and it changes
 *     for every project. That is deliberate: a column name is a word people and
 *     agents both use ("move it to QA"), and a per-project vocabulary makes that
 *     sentence ambiguous.
 *   - which of them a project SHOWS is per project. Dev work wants four columns;
 *     a personal list wants one and `done`. Same words, different boards.
 *
 * `done` is in neither list — every board ends with it and nothing can remove it.
 */
export function TaskColumnsDialog({
  open, onClose, pid, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Omitted on the aggregated view: only the catalog is editable there. */
  pid?: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<BoardColumn[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Which rows have their automation open. Collapsed by default: most columns
  // have none, and four always-visible agent fields turn the dialog into a form.
  const [openHooks, setOpenHooks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        if (pid) {
          const { columns, catalog: cat } = await Tasks.columns.forProject(pid);
          if (!alive) return;
          setCatalog(cat);
          setPicked(columns.filter((c) => c.id !== "done").map((c) => c.id));
        } else {
          const { columns } = await Tasks.columns.catalog();
          if (!alive) return;
          setCatalog(columns);
          setPicked(columns.map((c) => c.id));
        }
        setDraft("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("common.error_generic"));
      }
    })();
    return () => { alive = false; };
  }, [open, pid]); // eslint-disable-line react-hooks/exhaustive-deps

  const slugify = (s: string) =>
    s.trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

  const addColumn = () => {
    const label = draft.trim();
    const id = slugify(label);
    if (!id || id === "done" || catalog.some((c) => c.id === id)) return;
    setCatalog((prev) => [...prev, { id, label }]);
    setPicked((prev) => [...prev, id]);
    setDraft("");
  };

  const removeColumn = (id: string) => {
    setCatalog((prev) => prev.filter((c) => c.id !== id));
    setPicked((prev) => prev.filter((x) => x !== id));
  };

  const rename = (id: string, label: string) =>
    setCatalog((prev) => prev.map((c) => (c.id === id ? { ...c, label: label.trim() || null } : c)));

  const setHook = (id: string, patch: { agent?: string; instruction?: string }) =>
    setCatalog((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const agent = (patch.agent ?? c.on_enter?.agent ?? "").trim().toLowerCase();
      const instruction = (patch.instruction ?? c.on_enter?.instruction ?? "").trim();
      // No agent, no hook: an instruction with nobody to carry it out would be
      // saved and silently never run.
      return { ...c, on_enter: agent ? { agent, instruction: instruction || null } : null };
    }));

  const toggleHook = (id: string) =>
    setOpenHooks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const togglePick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    if (catalog.length === 0) {
      toast.error(t("tasks.columns_need_one"));
      return;
    }
    setBusy(true);
    try {
      await Tasks.columns.saveCatalog(catalog);
      // The project's pick is saved AFTER the catalog, so a column added in the
      // same edit is already known when the subset referencing it is stored.
      if (pid) await Tasks.columns.saveForProject(pid, picked);
      toast.success(t("common.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("tasks.columns_title")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={busy} data-testid="columns-save" onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-fg">{t("tasks.columns_hint")}</p>

        <Field label={t("tasks.columns_catalog")} hint={pid ? t("tasks.columns_pick_hint") : undefined}>
          <ul className="space-y-1.5" data-testid="columns-list">
            {catalog.map((col) => (
              <li key={col.id} className="flex flex-wrap items-center gap-2">
                {pid && (
                  <SelectCheckbox
                    checked={picked.includes(col.id)}
                    onToggle={() => togglePick(col.id)}
                    label={t("tasks.columns_show", { name: columnLabel(col) })}
                    testId={`column-pick-${col.id}`}
                  />
                )}
                <Input
                  value={col.label ?? columnLabel(col)}
                  data-testid={`column-label-${col.id}`}
                  className={cn("text-xs", pid && !picked.includes(col.id) && "opacity-50")}
                  onChange={(e) => rename(col.id, e.target.value)}
                />
                <span className="w-20 shrink-0 truncate font-mono text-[10px] text-muted-fg" title={col.id}>
                  {col.id}
                </span>
                <button
                  type="button"
                  aria-label={t("tasks.columns_automation", { name: columnLabel(col) })}
                  data-testid={`column-hook-${col.id}`}
                  className={cn(
                    "shrink-0",
                    col.on_enter?.agent ? "text-primary" : "text-muted-fg hover:text-fg",
                  )}
                  onClick={() => toggleHook(col.id)}
                >
                  <Zap size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t("tasks.columns_remove", { name: columnLabel(col) })}
                  data-testid={`column-remove-${col.id}`}
                  className="shrink-0 text-muted-fg hover:text-destructive"
                  onClick={() => removeColumn(col.id)}
                >
                  <X size={14} />
                </button>
                {(openHooks.has(col.id) || col.on_enter?.agent) && (
                  <div className="mt-1 w-full space-y-1.5 rounded-lg border border-border bg-muted/20 p-2">
                    <div className="text-[10px] text-muted-fg">{t("tasks.columns_automation_hint")}</div>
                    <Input
                      value={col.on_enter?.agent ?? ""}
                      data-testid={`column-hook-agent-${col.id}`}
                      placeholder={t("tasks.columns_hook_agent_ph")}
                      className="text-xs"
                      onChange={(e) => setHook(col.id, { agent: e.target.value })}
                    />
                    <Input
                      value={col.on_enter?.instruction ?? ""}
                      data-testid={`column-hook-instruction-${col.id}`}
                      placeholder={t("tasks.columns_hook_instruction_ph")}
                      className="text-xs"
                      disabled={!col.on_enter?.agent}
                      onChange={(e) => setHook(col.id, { instruction: e.target.value })}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Field>

        <Field label={t("tasks.columns_add")}>
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              data-testid="column-new"
              placeholder={t("tasks.columns_add_ph")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColumn(); } }}
            />
            <Button size="sm" disabled={!draft.trim()} data-testid="column-add" onClick={addColumn}>
              <Plus size={13} />
            </Button>
          </div>
        </Field>

        <p className="text-[10px] text-muted-fg">{t("tasks.columns_done_note")}</p>
      </div>
    </Dialog>
  );
}
