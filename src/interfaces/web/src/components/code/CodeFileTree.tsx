import { useState, useCallback, useEffect } from "react";
import { File, Folder, FolderOpen, ChevronRight, ChevronsUpDown, RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { toneText } from "../../lib/tone";
import { Empty, Spinner } from "../ui";
import { Tip } from "../ui/tip";
import { ProjectFiles } from "../../lib/api/projectFiles";
import type { FileNode } from "../../types/daemon";
import { t } from "../../i18n";

function TreeNode({
  node,
  depth,
  onOpenFile,
  openDirs,
  toggleDir,
}: {
  node: FileNode;
  depth: number;
  onOpenFile: (path: string) => void;
  openDirs: Set<string>;
  toggleDir: (path: string) => void;
}) {
  const isDir = node.type === "dir";
  const open = isDir && openDirs.has(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => isDir ? toggleDir(node.path) : onOpenFile(node.path)}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={cn(
          "flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-[11px] rounded transition-colors",
          "hover:bg-accent/40",
          isDir ? "text-foreground/80" : "text-foreground/70",
        )}
      >
        {isDir ? (
          <>
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
            {open ? <FolderOpen className={cn("size-3.5 shrink-0", toneText.amber)} /> : <Folder className={cn("size-3.5 shrink-0", toneText.amber)} />}
          </>
        ) : (
          <>
            <span className="size-3 shrink-0" />
            <File className={cn("size-3.5 shrink-0", toneText.sky)} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && node.children && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              openDirs={openDirs}
              toggleDir={toggleDir}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function CodeFileTree({
  pid,
  // projectPath is accepted (CodeScreen passes it) but nothing here reads it.
  className,
  onOpenFile,
}: {
  pid: string;
  projectPath?: string;
  className?: string;
  onOpenFile?: (path: string) => void;
}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Open-dir state lifted out of TreeNode so the parent can collapse all at once.
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ProjectFiles.tree(pid);
      setTree(r.tree);
      setLoaded(true);
    } catch {
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  // Load on first render and whenever the project changes. Also reset the
  // expanded set so a fresh project starts fully collapsed.
  useEffect(() => {
    setOpenDirs(new Set());
    void loadFiles();
  }, [loadFiles]);

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setOpenDirs(new Set());
  }, []);

  const anyOpen = openDirs.size > 0;

  return (
    <div className={cn("flex h-full flex-col", className)} data-testid="code-file-tree">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("code_module.tree_title")}</span>
        <div className="flex items-center gap-0.5">
          <Tip content={t("code_module.tree_collapse_all")}>
            <button
              type="button"
              onClick={collapseAll}
              disabled={!anyOpen}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronsUpDown className="size-3" />
            </button>
          </Tip>
          <Tip content={t("code_module.reload")}>
            <button
              type="button"
              onClick={() => void loadFiles()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {loading ? <Spinner size={12} /> : <RefreshCw className="size-3" />}
            </button>
          </Tip>
        </div>
      </div>

      {/* File tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!loaded ? (
          <div className="flex justify-center pt-6"><Spinner size={14} /></div>
        ) : tree.length === 0 ? (
          <div className="p-3"><Empty icon={File}>{t("files.empty")}</Empty></div>
        ) : (
          <ul>
            {tree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onOpenFile={onOpenFile ?? (() => {})}
                openDirs={openDirs}
                toggleDir={toggleDir}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
