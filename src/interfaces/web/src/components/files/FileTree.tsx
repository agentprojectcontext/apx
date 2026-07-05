import { useState, useEffect } from "react";
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  FileText, FileCode, Image as ImageIcon, File, Trash2,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { FileNode, FileKind } from "../../types/daemon";

function kindIcon(kind?: FileKind) {
  switch (kind) {
    case "markdown": return { Icon: FileText, color: "text-sky-500" };
    case "text": return { Icon: FileCode, color: "text-amber-500" };
    case "image": return { Icon: ImageIcon, color: "text-pink-500" };
    default: return { Icon: File, color: "text-muted-foreground" };
  }
}

// Ancestor dir paths of a file path, so the tree can auto-expand to a selection.
function ancestors(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

function Row({
  node, depth, selectedPath, expanded, toggle, onSelect, onDelete,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  toggle: (p: string) => void;
  onSelect: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
}) {
  const isDir = node.type === "dir";
  const open = expanded.has(node.path);
  const selected = selectedPath === node.path;
  const { Icon, color } = isDir
    ? { Icon: open ? FolderOpen : Folder, color: "text-muted-foreground" }
    : kindIcon(node.kind);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1.5 py-1 text-[13px] cursor-pointer",
          selected ? "bg-primary/15 text-foreground" : "hover:bg-accent/40 text-foreground/80",
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={() => (isDir ? toggle(node.path) : onSelect(node))}
      >
        {isDir ? (
          open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
               : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon className={cn("size-3.5 shrink-0", color)} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {onDelete && !isDir && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(node); }}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500"
            aria-label={`delete ${node.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {isDir && open && node.children?.map((child) => (
        <Row
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function FileTree({
  nodes, selectedPath, onSelect, onDelete, className,
}: {
  nodes: FileNode[];
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Auto-expand ancestors of the current selection so it's always visible.
  useEffect(() => {
    if (!selectedPath) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestors(selectedPath)) next.add(a);
      return next;
    });
  }, [selectedPath]);

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });

  return (
    <div className={cn("select-none", className)}>
      {nodes.map((node) => (
        <Row
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
