import "../styles/panel-parts.css";
import type { Result, SurfaceSummary } from "@apx/protocol";
import { Icons, SearchField, SegmentedControl } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { inProject, type ProjectEntry, realProjectId, threadAgent } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { KindIcon, kindLabel, kindOf } from "../surfaces/artifactKind.tsx";
import { DocumentDrawer, WidgetDrawer } from "./ArtifactPanel.tsx";
import { ArtifactTile } from "./ArtifactTile.tsx";
import { ProjectEmpty } from "./ProjectEmpty.tsx";
import { useSubScope } from "./subScope.tsx";

type Filter = "all" | "widgets" | "documents";
/** A document, with the project whose chat holds it. */
type Doc = Result<"documents.list">["documents"][number] & { project_id?: string | undefined };
type Item = { kind: "widget"; at: string; widget: SurfaceSummary } | { kind: "document"; at: string; doc: Doc };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the project's agents made, its subprojects' too: its widgets (live pages, on the board or not) and the documents
 * its chats hold, the newest first, as a gallery. Each opens beside it (the gallery stays in view): a widget live, a
 * document to read.
 */
export function ProjectArtifacts({ project }: { project: ProjectEntry }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const threads = useData((s) => s.threads);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<Doc[] | undefined>();
  const [open, setOpen] = useState<string>();
  const agents = useData((s) => s.agents);
  const { subs, subOf } = useSubScope(project);
  const pid = realProjectId(project.id);
  const subIds = subs.map((p) => p.id).join(",");

  const load = useCallback(async () => {
    const list = async (id: string | undefined) =>
      (await client.call("documents.list", id ? { project_id: id } : {})).documents.map((d) => ({
        ...d,
        project_id: id,
      }));
    try {
      const all = await Promise.all([list(pid), ...(subIds ? subIds.split(",") : []).map((id) => list(id))]);
      setDocs(all.flat());
    } catch (e) {
      setDocs([]);
      notify(t("error.artifacts", { error: errText(e) }));
    }
  }, [pid, subIds, t]);
  useEffect(() => void load(), [load]);

  const items = useMemo(() => {
    const widgets: Item[] = Object.values(surfaces)
      .filter((s) => inProject(s, project.id) || subOf(s.project_id))
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
  }, [surfaces, docs, project.id, subOf, filter, query]);

  const chatTitle = (id: string | undefined) => (id ? (threads[id]?.title ?? "") : "");
  // A document is the work of the agent of the chat it is in.
  const docMaker = (d: Doc) => {
    const agent = threadAgent(threads[d.thread_id], agents);
    return agent ? ({ kind: "agent", id: agent.id } as const) : undefined;
  };
  // In the project that holds the chat: a subproject's chat opens in the subproject.
  const openChat = (id: string, where?: string) => go.project(where ?? project.id, "chats", id);
  // A chat's side panel shows the document in the chat it came from.
  const openDocInChat = (d: Doc) => {
    openChat(d.thread_id, d.project_id);
    go.document(d.media_id);
  };
  const toggle = (id: string) => setOpen((o) => (o === id ? undefined : id));
  const openWidget = open ? surfaces[open] : undefined;
  const openDoc = open ? docs?.find((d) => d.media_id === open) : undefined;

  return (
    <div className="memory artifacts">
      <div className="team__head">
        <div className="team__titles">
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
        <ProjectEmpty name={project.name}>{query ? t("artifacts.noMatch") : undefined}</ProjectEmpty>
      ) : (
        <ul className="projart__grid" aria-label={t("project.tab.artifacts")}>
          {items.map((i) =>
            i.kind === "widget" ? (
              <ArtifactTile
                key={i.widget.id}
                title={i.widget.title}
                icon={<KindIcon kind={kindOf(i.widget)} size={24} />}
                kind={kindLabel(kindOf(i.widget), t)}
                maker={i.widget.created_by === "owner" ? { kind: "owner" } : { kind: "agent", id: i.widget.created_by }}
                at={i.widget.updated_at}
                sub={subOf(i.widget.project_id)}
                mark={i.widget.pinned ? t("artifacts.onBoard") : undefined}
                selected={i.widget.id === open}
                onOpen={() => toggle(i.widget.id)}
                onChat={
                  chatTitle(i.widget.thread_id)
                    ? () => openChat(i.widget.thread_id ?? "", i.widget.project_id)
                    : undefined
                }
              />
            ) : (
              <ArtifactTile
                key={i.doc.media_id}
                title={i.doc.title}
                icon={<Icons.FileText size={24} />}
                kind={t("artifacts.kind.document")}
                maker={docMaker(i.doc)}
                at={i.doc.created_at}
                sub={subOf(i.doc.project_id)}
                selected={i.doc.media_id === open}
                onOpen={() => toggle(i.doc.media_id)}
                onChat={() => openChat(i.doc.thread_id, i.doc.project_id)}
              />
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
