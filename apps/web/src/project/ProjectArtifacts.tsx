import type { Result, SurfaceSummary } from "@apx/protocol";
import { Badge, EmptyState, Icons, SearchField, SegmentedControl } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatBytes, shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { inProject, type ProjectEntry, realProjectId } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { DocumentDrawer, WidgetDrawer } from "./ArtifactPanel.tsx";

type Filter = "all" | "widgets" | "documents";
type Doc = Result<"documents.list">["documents"][number];
type Item = { kind: "widget"; at: string; widget: SurfaceSummary } | { kind: "document"; at: string; doc: Doc };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the project's agents made: its widgets (live pages, on the board or not) and the documents its chats hold, the
 * newest first. Each opens beside the list (the list stays in view): a widget live, a document to read.
 */
export function ProjectArtifacts({ project }: { project: ProjectEntry }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const threads = useData((s) => s.threads);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<Doc[] | undefined>();
  const [open, setOpen] = useState<string>();
  const pid = realProjectId(project.id);

  const load = useCallback(async () => {
    try {
      setDocs((await client.call("documents.list", pid ? { project_id: pid } : {})).documents);
    } catch (e) {
      setDocs([]);
      notify(t("error.artifacts", { error: errText(e) }));
    }
  }, [pid, t]);
  useEffect(() => void load(), [load]);

  const items = useMemo(() => {
    const widgets: Item[] = Object.values(surfaces)
      .filter((s) => inProject(s, project.id))
      .map((widget) => ({ kind: "widget", at: widget.updated_at, widget }));
    const documents: Item[] = (docs ?? []).map((doc) => ({ kind: "document", at: doc.created_at, doc }));
    const words = query.trim().toLowerCase();
    return [...(filter === "documents" ? [] : widgets), ...(filter === "widgets" ? [] : documents)]
      .filter((i) => {
        if (!words) return true;
        const text = i.kind === "widget" ? `${i.widget.title} ${i.widget.name}` : `${i.doc.title} ${i.doc.name}`;
        return text.toLowerCase().includes(words);
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [surfaces, docs, project.id, filter, query]);

  const chatTitle = (id: string | undefined, fallback = "") => (id ? (threads[id]?.title ?? fallback) : "");
  const openChat = (id: string) => go.project(project.id, "chats", id);
  // A chat's side panel shows the document in the chat it came from.
  const openDocInChat = (d: Doc) => {
    openChat(d.thread_id);
    go.document(d.media_id);
  };
  const toggle = (id: string) => setOpen((o) => (o === id ? undefined : id));
  const openWidget = open ? surfaces[open] : undefined;
  const openDoc = open ? docs?.find((d) => d.media_id === open) : undefined;
  const rowClass = (id: string) =>
    id === open ? "memory__row artifacts__row is-selected" : "memory__row artifacts__row";

  return (
    <div className="memory artifacts">
      <div className="team__head">
        <div className="team__titles">
          <div className="team__title">
            {t("project.tab.artifacts")} {docs && <span className="team__count">{items.length}</span>}
          </div>
          <div className="team__note">{t("artifacts.lead")}</div>
        </div>
        <SegmentedControl
          size="sm"
          label={t("artifacts.view")}
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "all", label: t("artifacts.filter.all") },
            { value: "widgets", label: t("artifacts.filter.widgets") },
            { value: "documents", label: t("artifacts.filter.documents") },
          ]}
        />
      </div>

      <SearchField
        size="sm"
        placeholder={t("artifacts.search")}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />

      {docs && !items.length ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.LayoutGrid />}>
          {query ? t("artifacts.noMatch") : t("artifacts.empty")}
        </EmptyState>
      ) : (
        <ul className="memory__list" aria-label={t("project.tab.artifacts")}>
          {items.map((i) =>
            i.kind === "widget" ? (
              <li key={i.widget.id} className={rowClass(i.widget.id)}>
                <button
                  type="button"
                  className="artifacts__open"
                  aria-expanded={i.widget.id === open}
                  onClick={() => toggle(i.widget.id)}
                >
                  <Icons.LayoutGrid size={16} />
                  <span className="artifacts__title">{i.widget.title}</span>
                </button>
                <div className="memory__meta">
                  <span>{t("artifacts.kind.widget")}</span>
                  <span>{t("artifacts.version", { n: i.widget.version })}</span>
                  <span>{shortWhen(i.widget.updated_at)}</span>
                  {i.widget.pinned && <Badge>{t("artifacts.onBoard")}</Badge>}
                  {i.widget.thread_id && chatTitle(i.widget.thread_id) && (
                    <button
                      type="button"
                      className="artifacts__chat"
                      onClick={() => openChat(i.widget.thread_id ?? "")}
                    >
                      {t("artifacts.inChat", { chat: chatTitle(i.widget.thread_id) })}
                    </button>
                  )}
                  <span className="memory__spacer" />
                  <SurfaceActions surface={i.widget} />
                </div>
              </li>
            ) : (
              <li key={i.doc.media_id} className={rowClass(i.doc.media_id)}>
                <button
                  type="button"
                  className="artifacts__open"
                  aria-expanded={i.doc.media_id === open}
                  onClick={() => toggle(i.doc.media_id)}
                >
                  <Icons.FileText size={16} />
                  <span className="artifacts__title">{i.doc.title}</span>
                </button>
                <div className="memory__meta">
                  <span>{t("artifacts.kind.document")}</span>
                  <span>{i.doc.name}</span>
                  <span>{formatBytes(i.doc.bytes)}</span>
                  <span>{shortWhen(i.doc.created_at)}</span>
                  <button type="button" className="artifacts__chat" onClick={() => openChat(i.doc.thread_id)}>
                    {t("artifacts.inChat", { chat: chatTitle(i.doc.thread_id, i.doc.thread_title) })}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {openWidget && <WidgetDrawer key={openWidget.id} surface={openWidget} onClose={() => setOpen(undefined)} />}
      {openDoc && (
        <DocumentDrawer
          key={openDoc.media_id}
          doc={openDoc}
          onOpenChat={() => openDocInChat(openDoc)}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
