import { useState } from "react";
import useSWR from "swr";
import { RefreshCw, FilePlus2, FolderOpen } from "lucide-react";
import { ProjectFiles, type FileScope } from "../../lib/api/projectFiles";
import type { FileNode, FileContent } from "../../types/daemon";
import { Spinner, Button, Empty } from "../ui";
import { useToast } from "../Toast";
import { t } from "../../i18n";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { NewFileDialog } from "./NewFileDialog";

// Shared file browser used by both /files (scope=project) and /docs
// (scope=docs). One component, two roots — the docs surface is just the same
// browser with `editable` on and a "new document" affordance.
export function FileBrowser({
  pid,
  scope,
  editable = false,
  emptyHint,
}: {
  pid: string;
  scope: FileScope;
  /** Allow editing text/markdown + creating/deleting files (docs surface). */
  editable?: boolean;
  emptyHint?: string;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const treeKey = `/projects/${pid}/fs/tree?scope=${scope}`;
  const tree = useSWR(treeKey, () => ProjectFiles.tree(pid, scope));

  const fileKey = selected ? `/projects/${pid}/fs/file?scope=${scope}&path=${selected}` : null;
  const file = useSWR<FileContent | null>(fileKey, () => (selected ? ProjectFiles.read(pid, selected, scope) : null));

  const onSelect = (node: FileNode) => setSelected(node.path);

  const onSave = editable
    ? async (content: string) => {
        if (!selected) return;
        await ProjectFiles.write(pid, selected, content, scope);
        toast.success(t("files.saved"));
        void file.mutate();
      }
    : undefined;

  const onDelete = editable
    ? async (node: FileNode) => {
        await ProjectFiles.remove(pid, node.path, scope);
        if (selected === node.path) setSelected(null);
        toast.success(t("files.deleted"));
        void tree.mutate();
      }
    : undefined;

  const onCreated = (path: string) => {
    setNewOpen(false);
    setSelected(path);
    void tree.mutate();
  };

  const nodes = tree.data?.tree ?? [];
  const isEmpty = !tree.isLoading && nodes.length === 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card">
      {/* Sidebar: tree */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <FolderOpen className="size-4 text-muted-foreground" />
          <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {scope === "docs" ? t("files.docs_label") : t("files.files_label")}
          </span>
          {editable && (
            <button
              type="button"
              data-testid="docs-new"
              onClick={() => setNewOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("files.new_doc")}
              title={t("files.new_doc")}
            >
              <FilePlus2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void tree.mutate()}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("common.refresh")}
          >
            <RefreshCw className={tree.isValidating ? "size-3.5 animate-spin" : "size-3.5"} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {tree.isLoading ? (
            <div className="flex justify-center py-6"><Spinner size={14} /></div>
          ) : isEmpty ? (
            <div className="p-3">
              <Empty>
                <div className="space-y-2">
                  <p>{emptyHint ?? t("files.empty")}</p>
                  {editable && (
                    <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)}>
                      <FilePlus2 className="size-3.5" />{t("files.new_doc")}
                    </Button>
                  )}
                </div>
              </Empty>
            </div>
          ) : (
            <FileTree nodes={nodes} selectedPath={selected} onSelect={onSelect} onDelete={onDelete} />
          )}
          {tree.data?.truncated && (
            <p className="px-2 py-1 text-[10px] text-muted-foreground/60">{t("files.truncated")}</p>
          )}
        </div>
      </div>

      {/* Main: viewer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <FileViewer file={file.data ?? null} loading={!!fileKey && file.isLoading} onSave={onSave} />
      </div>

      {editable && (
        <NewFileDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          pid={pid}
          scope={scope}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
