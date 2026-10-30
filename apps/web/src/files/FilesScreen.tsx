import "../styles/resources.css";
import "../styles/shared-files.css";
import type { Author, SharedFile, SharedKind } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, ProjectTile, SegmentedControl, Select } from "@apx/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMediaUrl } from "../chat/parts/useMediaUrl.ts";
import { formatBytes, shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { DEFAULT_PID, projectEntries, projectInitial, projectName, projectTone } from "../data/identity.ts";
import { mediaUrl } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

type Kind = SharedKind | "all";
const KINDS: { id: Kind; label: MessageKey }[] = [
  { id: "all", label: "shared.kind.all" },
  { id: "image", label: "shared.kind.image" },
  { id: "video", label: "shared.kind.video" },
  { id: "audio", label: "shared.kind.audio" },
  { id: "document", label: "shared.kind.document" },
];
const ONE: Record<SharedKind, MessageKey> = {
  image: "shared.one.image",
  video: "shared.one.video",
  audio: "shared.one.audio",
  document: "shared.one.document",
};
const ICON: Record<SharedKind, ReactNode> = {
  image: <Icons.Image size={18} />,
  video: <Icons.Film size={18} />,
  audio: <Icons.Music size={18} />,
  document: <Icons.FileText size={18} />,
};
const PAGE = 60;

/** A picture's thumbnail, fetched only once its row comes near the screen. */
function Thumb({ file }: { file: SharedFile }) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || file.kind !== "image") return;
    const seen = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "200px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [file.kind]);
  const src = useMediaUrl(near ? file.media_id : undefined);
  return (
    <span ref={box} className={`sharedf__thumb sharedf__thumb--${file.kind}`}>
      {src ? <img src={src} alt="" /> : ICON[file.kind]}
    </span>
  );
}

function useWho(): (a: Author) => string {
  const t = useT();
  const agents = useData((s) => s.agents);
  return (a) =>
    a.kind === "user"
      ? t("shared.you")
      : a.kind === "agent"
        ? (agents[a.id]?.name ?? "")
        : a.kind === "person"
          ? a.name
          : a.kind === "surface"
            ? a.title
            : "";
}

function Row({ file }: { file: SharedFile }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const engine = useData((s) => s.threads[file.thread_id]?.engine);
  const who = useWho()(file.author);
  const [busy, setBusy] = useState(false);
  const name = file.name || t(ONE[file.kind]);
  const project = projectName(projects, file.project_id);
  const save = async () => {
    setBusy(true);
    try {
      const a = document.createElement("a");
      a.href = await mediaUrl(file.media_id);
      a.download = file.name || file.media_id;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="sharedf__row">
      <button
        type="button"
        className="sharedf__open"
        title={t("shared.goTo")}
        onClick={() => go.message(file.thread_id, file.message_id, engine)}
      >
        <Thumb file={file} />
        <span className="sharedf__info">
          <span className="sharedf__name">{name}</span>
          <span className="sharedf__meta">
            <span className="sharedf__project">
              <ProjectTile
                tone={projectTone(file.project_id ?? DEFAULT_PID)}
                initial={projectInitial(project)}
                size={14}
              />
              {project}
            </span>
            <span className="sharedf__chat">{file.thread_title}</span>
            {who && <span>{who}</span>}
          </span>
        </span>
        <span className="sharedf__when">
          <span>{shortWhen(file.created_at)}</span>
          {file.bytes > 0 && <span>{formatBytes(file.bytes)}</span>}
        </span>
        <span className="sharedf__go">
          {t("shared.goTo")}
          <Icons.ArrowRight size={14} />
        </span>
      </button>
      <IconButton label={t("shared.download")} icon={<Icons.Download size={16} />} disabled={busy} onClick={save} />
    </li>
  );
}

/** Every file sent in a chat, newest first, by kind and project; each one leads back to its message. */
export function FilesScreen() {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [kind, setKind] = useState<Kind>("all");
  const [project, setProject] = useState("");
  const [items, setItems] = useState<SharedFile[]>([]);
  const [counts, setCounts] = useState<Record<SharedKind, number>>();
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (offset: number) => {
    setLoading(true);
    try {
      const r = await client.call("media.shared", {
        ...(kind === "all" ? {} : { kind }),
        ...(project === DEFAULT_PID ? { base: true } : project ? { project } : {}),
        offset,
        limit: PAGE,
      });
      setItems((prev) => (offset ? [...prev, ...r.items] : r.items));
      setCounts(r.counts);
      setMore(r.more);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts over from the first page
  useEffect(() => {
    void load(0);
  }, [kind, project]);

  const total = counts ? counts.image + counts.video + counts.audio + counts.document : undefined;
  const shown = (k: Kind) => (k === "all" ? total : counts?.[k]);

  return (
    <section className="resv sharedf" aria-label={t("nav.files")}>
      <header className="resv__head">
        <div className="resv__titles">
          <h1 className="resv__title">{t("nav.files")}</h1>
          <p className="resv__lead">{t("shared.lead")}</p>
        </div>
        <div className="resv__bar">
          <SegmentedControl
            label={t("shared.kinds")}
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            options={KINDS.map((k) => ({
              value: k.id,
              label: (
                <span className="resv__tab">
                  {t(k.label)}
                  {shown(k.id) !== undefined && <span className="resv__count">{shown(k.id)}</span>}
                </span>
              ),
            }))}
          />
          <span className="resv__spacer" />
          <Select
            className="sharedf__projects"
            label={t("shared.project")}
            value={project}
            onValueChange={(v) => setProject(v ?? "")}
            options={[
              { value: "", label: t("shared.allProjects") },
              ...projectEntries(projects).map((p) => ({
                value: p.id,
                label: p.name,
                icon: <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} size={16} />,
              })),
            ]}
          />
        </div>
      </header>
      <div className="sharedf__body">
        {error ? (
          <EmptyState icon={<Icons.TriangleAlert />} title={t("shared.error", { error })} />
        ) : !items.length && !loading ? (
          <EmptyState icon={<Icons.Paperclip />} title={t(kind === "all" ? "shared.empty" : "shared.emptyKind")}>
            {kind === "all" ? t("shared.emptyText") : undefined}
          </EmptyState>
        ) : (
          <ul className="sharedf__list">
            {items.map((f) => (
              <Row key={`${f.message_id}:${f.media_id}`} file={f} />
            ))}
          </ul>
        )}
        {more && !error && (
          <div className="sharedf__more">
            <Button variant="secondary" size="sm" loading={loading} onClick={() => void load(items.length)}>
              {t("shared.more")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
