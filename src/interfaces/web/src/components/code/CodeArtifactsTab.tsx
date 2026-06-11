import { useRef, useState } from "react";
import useSWR from "swr";
import { Copy, RefreshCw, Trash2, FileCode2, Play, Pencil, Eye, SquarePen } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { Empty, Spinner } from "../ui";
import { Artifacts, type ArtifactEntry, type ArtifactRunResult } from "../../lib/api/artifacts";
import { useToast } from "../Toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "../ui/dialog";

interface Props {
  pid: string;
  onRunInTerminal?: (cmd: string) => void;
}

function ArtifactRow({
  pid,
  entry,
  onDeleted,
  onRenamed,
  onRunInTerminal,
}: {
  pid: string;
  entry: ArtifactEntry;
  onDeleted: () => void;
  onRenamed: () => void;
  onRunInTerminal?: (cmd: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<ArtifactRunResult | null>(null);
  const toast = useToast();

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // View dialog state
  const [viewOpen, setViewOpen] = useState(false);
  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Load detail only when a dialog is open
  const detailKey = viewOpen || editOpen ? ["artifact", pid, entry.name] : null;
  const detail = useSWR(detailKey, () => Artifacts.read(pid, entry.name), {
    revalidateOnFocus: false,
  });

  const looksRunnable = !detail.data?.content || detail.data.content.startsWith("#!");

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info("Copiado.");
    } catch {
      /* ignore */
    }
  };

  const run = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const r = await Artifacts.run(pid, entry.name);
      setRunResult(r);
      if (r.ok) toast.info(`exit 0 — ${r.durationMs}ms`);
      else toast.error(`exit ${r.exitCode ?? r.signal ?? "?"}${r.timedOut ? " (timeout)" : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("code_module.artifacts_delete_confirm"))) return;
    try {
      await Artifacts.remove(pid, entry.name);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const startRename = () => {
    setRenameValue(entry.name);
    setRenaming(true);
    // Focus after paint
    requestAnimationFrame(() => renameInputRef.current?.select());
  };

  const commitRename = async () => {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (!trimmed || trimmed === entry.name) return;
    try {
      await Artifacts.rename(pid, entry.name, trimmed);
      onRenamed();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const openEdit = () => {
    setEditContent(detail.data?.content ?? "");
    setEditOpen(true);
  };

  // When view dialog opens and data arrives, nothing extra needed.
  // When edit dialog opens, sync content from fetched detail.
  const handleEditOpen = (open: boolean) => {
    if (open) {
      setEditContent(detail.data?.content ?? "");
    }
    setEditOpen(open);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await Artifacts.write(pid, entry.name, editContent);
      toast.info("Guardado.");
      setEditOpen(false);
      onRenamed(); // refresh list (size may have changed)
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-md border border-border">
      {/* Row header: file icon + name (or rename input) + size */}
      <div className="flex w-full items-center gap-2 px-2 py-1.5 text-xs">
        <FileCode2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
        )}
        <button
          type="button"
          onClick={startRename}
          title="Renombrar"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {entry.size}b
        </span>
      </div>

      {/* Action bar — always visible */}
      <div className="space-y-2 border-t border-border p-2">
        <code className="block min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground w-full">
          {entry.path}
        </code>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {/* Ver button */}
          <Dialog open={viewOpen} onOpenChange={setViewOpen}>
            <button
              type="button"
              onClick={() => setViewOpen(true)}
              title="Ver contenido"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:text-blue-300"
            >
              <Eye className="size-3" />
              Ver
            </button>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-mono text-sm">{entry.name}</DialogTitle>
              </DialogHeader>
              {detail.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner size={16} />
                </div>
              ) : (
                <pre className="max-h-96 overflow-auto rounded bg-muted/50 p-3 font-mono text-[11px] leading-tight whitespace-pre-wrap break-all">
                  {detail.data?.content ?? ""}
                </pre>
              )}
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>

          {/* Editar button */}
          <Dialog open={editOpen} onOpenChange={handleEditOpen}>
            <button
              type="button"
              onClick={() => {
                setEditContent(detail.data?.content ?? "");
                setEditOpen(true);
              }}
              title="Editar contenido"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-300"
            >
              <SquarePen className="size-3" />
              Editar
            </button>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-mono text-sm">Editar — {entry.name}</DialogTitle>
              </DialogHeader>
              {detail.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner size={16} />
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="h-72 w-full resize-y rounded border border-border bg-background p-2 font-mono text-[11px] leading-tight outline-none focus:ring-1 focus:ring-ring"
                  spellCheck={false}
                />
              )}
              <DialogFooter>
                <DialogClose
                  render={
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    />
                  }
                >
                  Cancelar
                </DialogClose>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={saving || detail.isLoading}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium",
                    saving || detail.isLoading
                      ? "bg-muted text-muted-foreground"
                      : "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300",
                  )}
                >
                  {saving && <Spinner size={10} />}
                  Guardar
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Run button */}
          {looksRunnable && (
            <button
              type="button"
              onClick={() => onRunInTerminal?.(`apx artifact run ${entry.name}`)}
              title={t("code_module.artifacts_run")}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
            >
              <Play className="size-3" />
              {t("code_module.artifacts_run")}
            </button>
          )}

          <button
            type="button"
            onClick={() => void copy(entry.path)}
            title={t("code_module.artifacts_copy_path")}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Copy className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            title={t("code_module.artifacts_delete")}
            className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
          >
            <Trash2 className="size-3" />
          </button>
        </div>

        <div className="mt-1 text-[10px] text-muted-foreground">
          {t("code_module.artifacts_run_hint")}{" "}
          <code className="rounded bg-muted px-1 font-mono">
            apx artifact run {entry.name}
          </code>
        </div>

        {/* Run result display */}
        {runResult && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px]">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono",
                  runResult.ok
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                )}
              >
                exit {runResult.exitCode ?? runResult.signal ?? "?"}
              </span>
              {runResult.timedOut && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-700 dark:text-amber-300">
                  timeout
                </span>
              )}
              {runResult.truncated && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-700 dark:text-amber-300">
                  truncated
                </span>
              )}
              <span className="font-mono text-muted-foreground">
                {runResult.durationMs}ms
              </span>
            </div>
            {runResult.stdout && (
              <pre className="max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px] leading-tight">
                {runResult.stdout}
              </pre>
            )}
            {runResult.stderr && (
              <pre className="max-h-32 overflow-auto rounded bg-rose-500/5 p-2 text-[10px] leading-tight text-rose-700 dark:text-rose-300">
                {runResult.stderr}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// Artifacts tab: managed files stored under <project>/artifacts/. The agent
// puts reusable scripts here so the user can run them from a terminal.
export function CodeArtifactsTab({ pid, onRunInTerminal }: Props) {
  const list = useSWR(pid ? ["artifacts", pid] : null, () => Artifacts.list(pid));
  const entries = list.data || [];
  return (
    <div className="flex h-full flex-col" data-testid="code-artifacts-tab">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {entries.length > 0
            ? t("code_module.artifacts_count", { n: entries.length })
            : ""}
        </span>
        <button
          type="button"
          onClick={() => void list.mutate()}
          title="↻"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {list.isLoading ? <Spinner size={12} /> : <RefreshCw className="size-3" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {entries.length === 0 ? (
          <Empty>{t("code_module.artifacts_none")}</Empty>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((a) => (
              <ArtifactRow
                key={a.name}
                pid={pid}
                entry={a}
                onDeleted={() => void list.mutate()}
                onRenamed={() => void list.mutate()}
                onRunInTerminal={onRunInTerminal}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
