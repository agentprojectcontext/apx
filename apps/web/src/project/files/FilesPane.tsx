import type { FileEntry, Result } from "@apx/protocol";
import { Button, ContextMenu, EmptyState, Icons, MarkdownView, SegmentedControl, Skeleton } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { formatBytes } from "../../common/format.ts";
import { client } from "../../data/client.ts";
import { mediaKind, mediaOf, revealFile } from "../../data/files.ts";
import type { ProjectEntry } from "../../data/identity.ts";
import { useT } from "../../i18n/index.ts";
import { type FileChange, fileMenu, RenameDialog, TrashDialog } from "./FileActions.tsx";

type Read = Result<"files.read">;
type Mode = "view" | "source" | "split";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);

/** What the tree needs to reach and act on the folder, passed to every level. */
type TreeCtx = {
  project: string;
  root: string;
  /** Bumped after a change, so every open level reads its folder again. */
  version: number;
  picked: string | undefined;
  onPick(path: string): void;
  onAct(kind: "rename" | "trash", entry: FileEntry): void;
};

/**
 * The project's folder: a tree on the left (one level loaded at a time), the file on the right — text, Markdown,
 * images, video, audio and PDFs. Right-click a file or folder to show it in Finder, copy its path, rename it or move
 * it to the trash.
 */
export function FilesPane({ project }: { project: ProjectEntry }) {
  const t = useT();
  const [picked, setPicked] = useState<string>();
  const [version, setVersion] = useState(0);
  const [acting, setActing] = useState<{ kind: "rename" | "trash"; entry: FileEntry }>();
  if (!project.path)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.Folder />} title={t("files.noFolder")}>
          {t("files.noFolderBody")}
        </EmptyState>
      </div>
    );
  const root = project.path;
  const done = (c: FileChange) => {
    setActing(undefined);
    setVersion((v) => v + 1);
    // The open file follows its new name, or closes when it went to the trash.
    if (picked && c.kind === "renamed" && (picked === c.from || picked.startsWith(`${c.from}/`)))
      setPicked(c.to + picked.slice(c.from.length));
    if (picked && c.kind === "trashed" && (picked === c.path || picked.startsWith(`${c.path}/`))) setPicked(undefined);
  };
  const ctx: TreeCtx = {
    project: project.id,
    root,
    version,
    picked,
    onPick: setPicked,
    onAct: (kind, entry) => setActing({ kind, entry }),
  };
  return (
    <div className="files">
      <nav className="files__tree" aria-label={t("files.tree")}>
        <div className="files__root">
          <Icons.FolderOpen size={14} />
          <span>{t("files.repo")}</span>
        </div>
        <Folder ctx={ctx} dir="" depth={0} />
      </nav>
      <section className="files__view" aria-label={picked ?? t("files.none")}>
        {picked ? (
          <FileView key={`${picked}:${version}`} project={project.id} path={picked} />
        ) : (
          <EmptyState icon={<Icons.FileText />} title={t("files.none")}>
            {t("files.noneBody")}
          </EmptyState>
        )}
      </section>
      {acting?.kind === "rename" && (
        <RenameDialog project={project.id} entry={acting.entry} onDone={done} onClose={() => setActing(undefined)} />
      )}
      {acting?.kind === "trash" && (
        <TrashDialog project={project.id} entry={acting.entry} onDone={done} onClose={() => setActing(undefined)} />
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
          project: ctx.project,
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
    // A late answer for another folder or project is dropped.
    let live = true;
    client.call("files.tree", { project: ctx.project, dir }).then(
      (r) => {
        if (!live) return;
        setEntries(r.entries);
        setMore(r.truncated);
      },
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [ctx.project, dir, ctx.version]);
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

function FileView({ project, path }: { project: string; path: string }) {
  if (mediaKind(path)) return <MediaView project={project} path={path} />;
  return <TextView project={project} path={path} />;
}

/** The file's path and size, with "Show in Finder" and whatever the view adds. */
function FileHead({
  project,
  path,
  size,
  children,
}: {
  project: string;
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
        leadingIcon={<Icons.FolderOpen size={14} />}
        onClick={() => void revealFile(project, path)}
      >
        {t("files.reveal")}
      </Button>
    </header>
  );
}

/** An image, video, audio or PDF, shown from its bytes; too big or unreadable says so (Finder is one click away). */
function MediaView({ project, path }: { project: string; path: string }) {
  const t = useT();
  const kind = mediaKind(path);
  const [media, setMedia] = useState<{ url: string; bytes: number }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    let made: string | undefined;
    mediaOf(project, path).then(
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
  }, [project, path]);
  return (
    <>
      <FileHead project={project} path={path} {...(media ? { size: media.bytes } : {})} />
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

function TextView({ project, path }: { project: string; path: string }) {
  const t = useT();
  const [file, setFile] = useState<Read>();
  const [error, setError] = useState<string>();
  const md = isMarkdown(path);
  const [mode, setMode] = useState<Mode>(md ? "view" : "source");
  useEffect(() => {
    let live = true;
    client.call("files.read", { project, path }).then(
      (f) => live && setFile(f),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [project, path]);
  return (
    <>
      <FileHead project={project} path={path} {...(file ? { size: file.bytes } : {})}>
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
          <Button size="sm" variant="secondary" onClick={() => void revealFile(project, path)}>
            {t("files.reveal")}
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
