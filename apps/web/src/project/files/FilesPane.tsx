import type { FileEntry, Result } from "@apx/protocol";
import { EmptyState, Icons, MarkdownView, SegmentedControl, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { formatNumber } from "../../common/format.ts";
import { client } from "../../data/client.ts";
import type { ProjectEntry } from "../../data/identity.ts";
import { useT } from "../../i18n/index.ts";

type Read = Result<"files.read">;
type Mode = "view" | "source" | "split";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);
const size = (b: number) =>
  b >= 1024 * 1024 ? `${formatNumber(b / 1024 / 1024, { maximumFractionDigits: 1 })} MB` : `${Math.ceil(b / 1024)} KB`;

/** The project's folder, read-only: a tree on the left (one level loaded at a time), the file on the right. */
export function FilesPane({ project }: { project: ProjectEntry }) {
  const t = useT();
  const [picked, setPicked] = useState<string>();
  if (!project.path)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.Folder />} title={t("files.noFolder")}>
          {t("files.noFolderBody")}
        </EmptyState>
      </div>
    );
  return (
    <div className="files">
      <nav className="files__tree" aria-label={t("files.tree")}>
        <div className="files__root">
          <Icons.FolderOpen size={14} />
          <span>{t("files.repo")}</span>
        </div>
        <Folder project={project.id} dir="" depth={0} picked={picked} onPick={setPicked} />
      </nav>
      <section className="files__view" aria-label={picked ?? t("files.none")}>
        {picked ? (
          <FileView key={picked} project={project.id} path={picked} />
        ) : (
          <EmptyState icon={<Icons.FileText />} title={t("files.none")}>
            {t("files.noneBody")}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function Folder(props: { project: string; dir: string; depth: number; picked?: string; onPick(p: string): void }) {
  const t = useT();
  const [entries, setEntries] = useState<FileEntry[]>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    client.call("files.tree", { project: props.project, dir: props.dir }).then(
      (r) => {
        setEntries(r.entries);
        setMore(r.truncated);
      },
      (e: unknown) => setError(errText(e)),
    );
  }, [props.project, props.dir]);
  if (error) return <p className="files__error">{error}</p>;
  if (!entries) return <Skeleton height={18} className="files__loading" />;
  return (
    <ul className="files__list">
      {entries.map((e) =>
        e.kind === "dir" ? (
          <DirRow key={e.path} entry={e} {...props} />
        ) : (
          <li key={e.path}>
            <button
              type="button"
              aria-current={props.picked === e.path || undefined}
              className={`files__row${props.picked === e.path ? " is-on" : ""}`}
              style={{ paddingLeft: 8 + props.depth * 14 }}
              onClick={() => props.onPick(e.path)}
            >
              <Icons.FileText size={14} />
              <span className="files__name">{e.name}</span>
            </button>
          </li>
        ),
      )}
      {more && <li className="files__more">{t("files.more")}</li>}
      {!entries.length && props.depth === 0 && <li className="files__more">{t("files.emptyFolder")}</li>}
    </ul>
  );
}

function DirRow(props: { entry: FileEntry; project: string; depth: number; picked?: string; onPick(p: string): void }) {
  const [open, setOpen] = useState(false);
  const { entry: e } = props;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        className="files__row"
        style={{ paddingLeft: 8 + props.depth * 14 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
        {open ? <Icons.FolderOpen size={14} /> : <Icons.Folder size={14} />}
        <span className="files__name">{e.name}</span>
      </button>
      {open && (
        <Folder
          project={props.project}
          dir={e.path}
          depth={props.depth + 1}
          picked={props.picked}
          onPick={props.onPick}
        />
      )}
    </li>
  );
}

function FileView({ project, path }: { project: string; path: string }) {
  const t = useT();
  const [file, setFile] = useState<Read>();
  const [error, setError] = useState<string>();
  const md = isMarkdown(path);
  const [mode, setMode] = useState<Mode>(md ? "view" : "source");
  useEffect(() => {
    client.call("files.read", { project, path }).then(setFile, (e: unknown) => setError(errText(e)));
  }, [project, path]);
  return (
    <>
      <header className="files__head">
        <span className="files__path">{path}</span>
        {file && <span className="files__size">{size(file.bytes)}</span>}
        <span className="files__spacer" />
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
      </header>
      {error ? (
        <p className="files__error">{error}</p>
      ) : !file ? (
        <Skeleton height={200} />
      ) : file.binary ? (
        <EmptyState icon={<Icons.File />} title={t("files.binary")}>
          {t("files.binaryBody")}
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
