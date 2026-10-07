import type { FileEntry, Result } from "@apx/protocol";
import { Button, ContextMenu, EmptyState, IconButton, Icons, MarkdownView, SegmentedControl, Skeleton } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { formatBytes } from "../../common/format.ts";
import { client } from "../../data/client.ts";
import { coreOnThisComputer, downloadFile, type FileWhere, mediaKind, mediaOf, revealFile } from "../../data/files.ts";
import { useT } from "../../i18n/index.ts";
import { type FileChange, fileMenu, RenameDialog, TrashDialog } from "./FileActions.tsx";

type Read = Result<"files.read">;
type Mode = "view" | "source" | "split";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A stable key for effects: the scope object is new on every render. */
const whereKey = (w: FileWhere) =>
  "thread" in w ? `${w.scratch ? "s" : "t"}:${w.thread}` : "project" in w ? `p:${w.project}` : "base";
const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);

/** What the tree needs to reach and act on the folder, passed to every level. */
type TreeCtx = {
  where: FileWhere;
  /** The folder's own path, once the core has said it. */
  root: string;
  onRoot(root: string): void;
  /** Bumped after a change, so every open level reads its folder again. */
  version: number;
  picked: string | undefined;
  onPick(path: string): void;
  onAct(kind: "rename" | "trash", entry: FileEntry): void;
};

/** A project with no folder on this machine. */
export function NoFolder() {
  const t = useT();
  return (
    <div className="files files--empty">
      <EmptyState variant="dashed" size="lg" icon={<Icons.Folder />} title={t("files.noFolder")}>
        {t("files.noFolderBody")}
      </EmptyState>
    </div>
  );
}

/**
 * A folder, a project's or the one a chat works in: a tree on the left (one level loaded at a time), the file on the
 * right — text, Markdown, images, video, audio and PDFs. Right-click a file or folder to show it in Finder, copy its
 * path, rename it or move it to the trash.
 */
export function FilesPane({
  where,
  root: known = "",
  label,
  stacked = false,
}: {
  where: FileWhere;
  root?: string | undefined;
  /** The folder's name at the top: a project's says "Repository", a chat's shows the folder's own name. */
  label?: string | undefined;
  stacked?: boolean;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string>();
  const [version, setVersion] = useState(0);
  const [acting, setActing] = useState<{ kind: "rename" | "trash"; entry: FileEntry }>();
  const [root, setRoot] = useState(known);
  const done = (c: FileChange) => {
    setActing(undefined);
    setVersion((v) => v + 1);
    // The open file follows its new name, or closes when it went to the trash.
    if (picked && c.kind === "renamed" && (picked === c.from || picked.startsWith(`${c.from}/`)))
      setPicked(c.to + picked.slice(c.from.length));
    if (picked && c.kind === "trashed" && (picked === c.path || picked.startsWith(`${c.path}/`))) setPicked(undefined);
  };
  const ctx: TreeCtx = {
    where,
    root,
    onRoot: setRoot,
    version,
    picked,
    onPick: setPicked,
    onAct: (kind, entry) => setActing({ kind, entry }),
  };
  // Narrow (the chat's side panel): the tree, or the open file with a way back to it.
  const showTree = !stacked || !picked;
  const showView = !stacked || Boolean(picked);
  return (
    <div className={stacked ? "files files--stacked" : "files"}>
      {showTree && (
        <nav className="files__tree" aria-label={t("files.tree")}>
          <div className="files__root" title={root || undefined}>
            <Icons.FolderOpen size={14} />
            <span>{label ?? ("project" in where ? t("files.repo") : root.split("/").filter(Boolean).at(-1))}</span>
            {coreOnThisComputer() && (
              <IconButton
                size="sm"
                label={t("files.reveal")}
                icon={<Icons.ExternalLink size={12} />}
                onClick={() => void revealFile(where, "")}
              />
            )}
          </div>
          <Folder ctx={ctx} dir="" depth={0} />
        </nav>
      )}
      {showView && (
        <section className="files__view" aria-label={picked ?? t("files.none")}>
          {stacked && (
            <button type="button" className="files__back" onClick={() => setPicked(undefined)}>
              <Icons.ChevronLeft size={14} />
              {t("files.back")}
            </button>
          )}
          {picked ? (
            <FileView key={`${picked}:${version}`} where={where} path={picked} />
          ) : (
            <EmptyState icon={<Icons.FileText />} title={t("files.none")}>
              {t("files.noneBody")}
            </EmptyState>
          )}
        </section>
      )}
      {acting?.kind === "rename" && (
        <RenameDialog where={where} entry={acting.entry} onDone={done} onClose={() => setActing(undefined)} />
      )}
      {acting?.kind === "trash" && (
        <TrashDialog where={where} entry={acting.entry} onDone={done} onClose={() => setActing(undefined)} />
      )}
    </div>
  );
}

/** A tree row with its right-click menu. */
function Row({ ctx, entry, children }: { ctx: TreeCtx; entry: FileEntry; children: ReactNode }) {
  const t = useT();
  return (
    <ContextMenu
      items={fileMenu(
        { entry, absolute: `${ctx.root.replace(/\/+$/, "")}/${entry.path}` },
        {
          where: ctx.where,
          t,
          onRename: () => ctx.onAct("rename", entry),
          onTrash: () => ctx.onAct("trash", entry),
        },
      )}
    >
      {children}
    </ContextMenu>
  );
}

const ICON = { image: Icons.Image, video: Icons.Film, audio: Icons.Music, pdf: Icons.FileImage } as const;
function FileIcon({ path }: { path: string }) {
  const kind = mediaKind(path);
  const Icon = kind ? ICON[kind] : Icons.FileText;
  return <Icon size={14} />;
}

function Folder({ ctx, dir, depth }: { ctx: TreeCtx; dir: string; depth: number }) {
  const t = useT();
  const [entries, setEntries] = useState<FileEntry[]>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new version (after a rename or trash) reads it again.
  useEffect(() => {
    // A late answer for another folder is dropped.
    let live = true;
    client.call("files.tree", { ...ctx.where, dir }).then(
      (r) => {
        if (!live) return;
        if (!dir) ctx.onRoot(r.root);
        setEntries(r.entries);
        setMore(r.truncated);
      },
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [whereKey(ctx.where), dir, ctx.version]);
  if (error) return <p className="files__error">{error}</p>;
  if (!entries) return <Skeleton height={18} className="files__loading" />;
  return (
    <ul className="files__list">
      {entries.map((e) =>
        e.kind === "dir" ? (
          <DirRow key={e.path} entry={e} ctx={ctx} depth={depth} />
        ) : (
          <li key={e.path}>
            <Row ctx={ctx} entry={e}>
              <button
                type="button"
                aria-current={ctx.picked === e.path || undefined}
                className={`files__row${ctx.picked === e.path ? " is-on" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => ctx.onPick(e.path)}
              >
                <FileIcon path={e.name} />
                <span className="files__name">{e.name}</span>
              </button>
            </Row>
          </li>
        ),
      )}
      {more && <li className="files__more">{t("files.more")}</li>}
      {!entries.length && depth === 0 && <li className="files__more">{t("files.emptyFolder")}</li>}
    </ul>
  );
}

function DirRow({ entry: e, ctx, depth }: { entry: FileEntry; ctx: TreeCtx; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <Row ctx={ctx} entry={e}>
        <button
          type="button"
          aria-expanded={open}
          className="files__row"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
          {open ? <Icons.FolderOpen size={14} /> : <Icons.Folder size={14} />}
          <span className="files__name">{e.name}</span>
        </button>
      </Row>
      {open && <Folder ctx={ctx} dir={e.path} depth={depth + 1} />}
    </li>
  );
}

function FileView({ where, path }: { where: FileWhere; path: string }) {
  if (mediaKind(path)) return <MediaView where={where} path={path} />;
  return <TextView where={where} path={path} />;
}

/** The file's path and size, with "Show in Finder" and whatever the view adds. */
function FileHead({
  where,
  path,
  size,
  children,
}: {
  where: FileWhere;
  path: string;
  size?: number;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="files__head">
      <span className="files__path">{path}</span>
      {size != null && <span className="files__size">{formatBytes(size)}</span>}
      <span className="files__spacer" />
      {children}
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<Icons.Download size={14} />}
        onClick={() => void downloadFile(where, path)}
      >
        {t("files.download")}
      </Button>
      {coreOnThisComputer() && (
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Icons.FolderOpen size={14} />}
          onClick={() => void revealFile(where, path)}
        >
          {t("files.reveal")}
        </Button>
      )}
    </header>
  );
}

/** An image, video, audio or PDF, shown from its bytes; too big or unreadable says so (download is one click away). */
function MediaView({ where, path }: { where: FileWhere; path: string }) {
  const t = useT();
  const kind = mediaKind(path);
  const [media, setMedia] = useState<{ url: string; bytes: number }>();
  const [error, setError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope object is new each render; its key is what changes.
  useEffect(() => {
    let live = true;
    let made: string | undefined;
    mediaOf(where, path).then(
      (m) => {
        made = m.url;
        if (live) setMedia(m);
        else URL.revokeObjectURL(m.url);
      },
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [whereKey(where), path]);
  return (
    <>
      <FileHead where={where} path={path} {...(media ? { size: media.bytes } : {})} />
      {error ? (
        <EmptyState icon={<Icons.File />} title={t("files.noPreview")}>
          {error}
        </EmptyState>
      ) : !media ? (
        <Skeleton height={240} />
      ) : (
        <div className={`files__media is-${kind}`}>
          {kind === "image" && <img src={media.url} alt={path} />}
          {kind === "video" && (
            // biome-ignore lint/a11y/useMediaCaption: the owner's own files carry no captions.
            <video src={media.url} controls />
          )}
          {kind === "audio" && (
            // biome-ignore lint/a11y/useMediaCaption: the owner's own files carry no captions.
            <audio src={media.url} controls />
          )}
          {kind === "pdf" && <iframe src={media.url} title={path} />}
        </div>
      )}
    </>
  );
}

function TextView({ where, path }: { where: FileWhere; path: string }) {
  const t = useT();
  const [file, setFile] = useState<Read>();
  const [error, setError] = useState<string>();
  const md = isMarkdown(path);
  const [mode, setMode] = useState<Mode>(md ? "view" : "source");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope object is new each render; its key is what changes.
  useEffect(() => {
    let live = true;
    client.call("files.read", { ...where, path }).then(
      (f) => live && setFile(f),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [whereKey(where), path]);
  return (
    <>
      <FileHead where={where} path={path} {...(file ? { size: file.bytes } : {})}>
        {md && file?.text != null && (
          <SegmentedControl
            size="sm"
            label={t("files.mode")}
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            options={[
              { value: "view", label: t("files.mode.view") },
              { value: "source", label: t("files.mode.source") },
              { value: "split", label: t("files.mode.split") },
            ]}
          />
        )}
      </FileHead>
      {error ? (
        <p className="files__error">{error}</p>
      ) : !file ? (
        <Skeleton height={200} />
      ) : file.binary ? (
        <EmptyState icon={<Icons.File />} title={t("files.binary")}>
          {t("files.binaryBody")}
          <Button size="sm" variant="secondary" onClick={() => void downloadFile(where, path)}>
            {t("files.download")}
          </Button>
        </EmptyState>
      ) : (
        <div className={`files__body is-${mode}`}>
          {mode !== "view" && <pre className="files__source">{file.text}</pre>}
          {mode !== "source" && (
            <div className="files__md">
              <MarkdownView source={file.text ?? ""} />
            </div>
          )}
          {file.truncated && <p className="files__more">{t("files.truncated")}</p>}
        </div>
      )}
    </>
  );
}
