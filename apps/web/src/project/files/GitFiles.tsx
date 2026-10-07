import type { GitFile } from "@apx/protocol";
import { IconButton, Icons, SectionLabel } from "@apx/ui";
import { type ReactNode, useMemo, useState } from "react";
import { useT } from "../../i18n/index.ts";

/** Which repository of a project the calls go to: its folder's own, or one inside it by its path. */
export type At = { project: string; repo?: string };
/** How changed files are listed: flat with their folder beside them, or as a tree of folders. */
export type FilesView = "list" | "tree";
/** What the right side shows: a file's change (staged or not), or a commit and maybe one of its files. */
export type Pick = { kind: "file"; path: string; staged: boolean } | { kind: "commit"; sha: string; path?: string };

const STATUS_KEY = {
  M: "git.status.M",
  A: "git.status.A",
  D: "git.status.D",
  R: "git.status.R",
  C: "git.status.C",
  U: "git.status.U",
  "?": "git.status.untracked",
} as const;

/** A file row: its status letter, name (and folder, in the list), lines added and removed, and its action. */
export function FileRow({
  file,
  on,
  onPick,
  action,
  depth,
}: {
  file: GitFile;
  on: boolean;
  onPick(): void;
  action?: ReactNode;
  /** In a tree: how deep it sits, and no folder beside the name. */
  depth?: number;
}) {
  const t = useT();
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = depth === undefined && slash > 0 ? file.path.slice(0, slash) : "";
  const key = STATUS_KEY[file.status as keyof typeof STATUS_KEY];
  return (
    <li className={`git__file${on ? " is-on" : ""}`}>
      <button
        type="button"
        className="git__filebtn"
        onClick={onPick}
        title={file.from ?? file.path}
        style={depth ? { paddingLeft: 6 + depth * 14 } : undefined}
      >
        <span className={`git__letter is-${file.status === "?" ? "U" : file.status}`} title={key ? t(key) : undefined}>
          {file.status === "?" ? "U" : file.status}
        </span>
        <span className="git__name">{name}</span>
        {dir && <span className="git__dir">{dir}</span>}
        {(file.added != null || file.removed != null) && (
          <span className="git__counts">
            {file.added ? <span className="is-add">+{file.added}</span> : null}
            {file.removed ? <span className="is-del">−{file.removed}</span> : null}
          </span>
        )}
      </button>
      {action}
    </li>
  );
}

type Node = { name: string; path: string; dirs: Map<string, Node>; files: GitFile[] };

/** Files as nested folders; a folder with a single folder inside reads as one ("src/routes"). */
function treeOf(files: GitFile[]): Node {
  const root: Node = { name: "", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      let next = node.dirs.get(part);
      if (!next) {
        next = { name: part, path, dirs: new Map(), files: [] };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(f);
  }
  const squash = (n: Node): Node => {
    for (const [k, d] of n.dirs) n.dirs.set(k, squash(d));
    const only = n.dirs.size === 1 && !n.files.length && n.name ? [...n.dirs.values()][0] : undefined;
    return only ? { ...only, name: `${n.name}/${only.name}` } : n;
  };
  return squash(root);
}

/** A group of changed files (staged, or not yet), listed or as a tree, with one action per file and one for all. */
export function FileGroup({
  title,
  files,
  staged,
  view,
  pick,
  onPick,
  onMove,
}: {
  title: string;
  files: GitFile[];
  staged: boolean;
  view: FilesView;
  pick: Pick | undefined;
  onPick(p: Pick): void;
  onMove(paths: string[]): void;
}) {
  const t = useT();
  const tree = useMemo(() => treeOf(files), [files]);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (!files.length) return null;
  const moveLabel = staged ? t("git.unstage") : t("git.stage");
  const moveIcon = staged ? <Icons.Minus size={12} /> : <Icons.Plus size={12} />;
  const row = (f: GitFile, depth?: number) => (
    <FileRow
      key={f.path}
      file={f}
      {...(depth === undefined ? {} : { depth })}
      on={pick?.kind === "file" && pick.staged === staged && pick.path === f.path}
      onPick={() => onPick({ kind: "file", path: f.path, staged })}
      action={
        <IconButton
          size="sm"
          className="git__move"
          label={`${moveLabel}: ${f.path}`}
          tooltip={moveLabel}
          icon={moveIcon}
          onClick={() => onMove([f.path])}
        />
      }
    />
  );
  const filesUnder = (n: Node): string[] => [
    ...n.files.map((f) => f.path),
    ...[...n.dirs.values()].flatMap(filesUnder),
  ];
  const folder = (n: Node, depth: number): ReactNode[] => {
    const dirs = [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const own = [...n.files].sort((a, b) => a.path.localeCompare(b.path));
    return [
      ...dirs.flatMap((d) => {
        const open = !folded.has(d.path);
        return [
          <li key={`d:${d.path}`} className="git__file git__folder">
            <button
              type="button"
              className="git__filebtn"
              aria-expanded={open}
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() =>
                setFolded((s) => {
                  const next = new Set(s);
                  if (open) next.add(d.path);
                  else next.delete(d.path);
                  return next;
                })
              }
            >
              {open ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
              {open ? <Icons.FolderOpen size={13} /> : <Icons.Folder size={13} />}
              <span className="git__name">{d.name}</span>
            </button>
            <IconButton
              size="sm"
              className="git__move"
              label={`${moveLabel}: ${d.path}`}
              tooltip={moveLabel}
              icon={moveIcon}
              onClick={() => onMove(filesUnder(d))}
            />
          </li>,
          ...(open ? folder(d, depth + 1) : []),
        ];
      }),
      ...own.map((f) => row(f, depth + 1)),
    ];
  };
  return (
    <>
      <SectionLabel
        className="git__label"
        action={
          <span className="git__labelend">
            <span className="git__count">{files.length}</span>
            <IconButton
              size="sm"
              label={staged ? t("git.unstageAll") : t("git.stageAll")}
              icon={moveIcon}
              onClick={() => onMove(files.map((f) => f.path))}
            />
          </span>
        }
      >
        {title}
      </SectionLabel>
      <ul className="git__files">{view === "tree" ? folder(tree, 0) : files.map((f) => row(f))}</ul>
    </>
  );
}
