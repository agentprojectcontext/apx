import "../styles/resources.css";
import "../styles/shared-files.css";
import type { SharedFile, SharedKind, SharedOrder } from "@apx/protocol";
import { Button, EmptyState, Icons, ProjectTile, SearchField, SegmentedControl, Select } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaUrl } from "../chat/parts/useMediaUrl.ts";
import { client } from "../data/client.ts";
import { DEFAULT_PID, projectEntries, projectInitial, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SharedPreview } from "./SharedPreview.tsx";
import { kindIcon, ONE, Sender, SharedActions, when } from "./sharedFile.tsx";

type Kind = SharedKind | "all";
const KINDS: { id: Kind; label: MessageKey }[] = [
  { id: "all", label: "shared.kind.all" },
  { id: "image", label: "shared.kind.image" },
  { id: "video", label: "shared.kind.video" },
  { id: "audio", label: "shared.kind.audio" },
  { id: "document", label: "shared.kind.document" },
];
const ORDERS: { id: SharedOrder; label: MessageKey }[] = [
  { id: "new", label: "shared.order.new" },
  { id: "old", label: "shared.order.old" },
  { id: "az", label: "shared.order.az" },
  { id: "za", label: "shared.order.za" },
];
const PAGE = 60;
const SEARCH_WAIT_MS = 200;

/** A picture's thumbnail, fetched only once its card comes near the screen; other kinds show their icon. */
function Thumb({ file }: { file: SharedFile }) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || file.kind !== "image") return;
    const seen = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "300px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [file.kind]);
  const src = useMediaUrl(near ? file.media_id : undefined);
  return (
    <span ref={box} className={`sharedf__thumb is-${file.kind}`}>
      {src ? <img src={src} alt="" /> : kindIcon(file.kind, 28)}
      {file.kind === "video" && (
        <span className="sharedf__play" aria-hidden="true">
          <Icons.Play size={14} />
        </span>
      )}
    </span>
  );
}

function Card({ file, onOpen }: { file: SharedFile; onOpen: () => void }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const project = projectName(projects, file.project_id);
  const name = file.name || t(ONE[file.kind]);
  return (
    <li className="sharedf__card">
      <button type="button" className="sharedf__open" onClick={onOpen} aria-label={name}>
        <Thumb file={file} />
      </button>
      <div className="sharedf__cardbody">
        <span className="sharedf__name" title={name}>
          {name}
        </span>
        <span className="sharedf__meta" title={`${project} · ${file.thread_title}`}>
          <span className="sharedf__project">
            <ProjectTile
              tone={projectTone(file.project_id ?? DEFAULT_PID)}
              initial={projectInitial(project)}
              size={14}
            />
            {project}
          </span>
          <span className="sharedf__chat">{file.thread_title}</span>
        </span>
        <time className="sharedf__when" dateTime={file.created_at}>
          {when(file.created_at)}
        </time>
        <span className="sharedf__foot">
          <span className="sharedf__who">
            <Sender author={file.author} />
          </span>
          <SharedActions file={file} />
        </span>
      </div>
    </li>
  );
}

/** Every file sent in a chat, as cards by kind, project and name; one opens live over the list. */
export function FilesScreen() {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [kind, setKind] = useState<Kind>("all");
  const [project, setProject] = useState("");
  const [order, setOrder] = useState<SharedOrder>("new");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SharedFile[]>([]);
  const [counts, setCounts] = useState<Record<SharedKind, number>>();
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number>();

  useEffect(() => {
    const wait = setTimeout(() => setQuery(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(wait);
  }, [typed]);

  const load = async (offset: number) => {
    setLoading(true);
    try {
      const r = await client.call("media.shared", {
        ...(kind === "all" ? {} : { kind }),
        ...(project === DEFAULT_PID ? { base: true } : project ? { project } : {}),
        ...(query ? { query } : {}),
        order,
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
    setOpen(undefined);
    void load(0);
  }, [kind, project, query, order]);

  const back = useCallback(() => setOpen(undefined), []);
  const step = useCallback(
    (by: -1 | 1) => setOpen((i) => (i === undefined ? i : Math.min(Math.max(i + by, 0), items.length - 1))),
    [items.length],
  );
  const shown = open === undefined ? undefined : items[open];
  const total = counts ? counts.image + counts.video + counts.audio + counts.document : undefined;
  const countOf = (k: Kind) => (k === "all" ? total : counts?.[k]);

  return (
    <section className="resv sharedf" aria-label={t("nav.files")}>
      {shown && <SharedPreview file={shown} onBack={back} onStep={items.length > 1 ? step : undefined} />}
      <div className="sharedf__list" hidden={shown !== undefined}>
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
                    {countOf(k.id) !== undefined && <span className="resv__count">{countOf(k.id)}</span>}
                  </span>
                ),
              }))}
            />
            <span className="resv__spacer" />
            <SearchField
              className="resv__search"
              aria-label={t("shared.search")}
              placeholder={t("shared.search")}
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
            />
            <Select
              className="sharedf__select"
              label={t("shared.order")}
              value={order}
              onValueChange={(v) => setOrder((v as SharedOrder | null) ?? "new")}
              options={ORDERS.map((o) => ({ value: o.id, label: t(o.label) }))}
            />
            <Select
              className="sharedf__select"
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
            <EmptyState
              icon={<Icons.Paperclip />}
              title={t(query ? "shared.emptySearch" : kind === "all" ? "shared.empty" : "shared.emptyKind")}
            >
              {!query && kind === "all" ? t("shared.emptyText") : undefined}
            </EmptyState>
          ) : (
            <ul className="sharedf__grid">
              {items.map((f, i) => (
                <Card key={`${f.message_id}:${f.media_id}`} file={f} onOpen={() => setOpen(i)} />
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
      </div>
    </section>
  );
}
