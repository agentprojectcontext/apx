import { useMemo, useState } from "react";
import useSWR from "swr";
import { Brain, BrainCircuit, Bot, Crown, NotebookPen, RefreshCw } from "lucide-react";
import { Agents, Projects } from "../../lib/api";
import { Notebook } from "../../lib/api/notebook";
import type { AgentEntry, FileContent } from "../../types/daemon";
import { cn } from "../../lib/cn";
import { Spinner, Empty } from "../ui";
import { useToast } from "../Toast";
import { t } from "../../i18n";
import { toneText } from "../../lib/tone";
import { usePersonaName } from "../../hooks/usePersonaName";
import { FileViewer } from "../files/FileViewer";

// Which memory is open in the right pane. A project has TWO: "project" is the
// curated `.apc/memory.md` that git carries, "local" is the never-committed file
// the agent writes. Keeping them separate rows is the point — the boundary is
// what stops an automatic note putting a pasted token in someone's repo.
type Sel =
  | { kind: "notebook" }
  | { kind: "project" }
  | { kind: "local" }
  | { kind: "agent"; slug: string };

function selId(s: Sel): string {
  return s.kind === "agent" ? `agent:${s.slug}` : s.kind;
}

// On-disk-ish path shown in the viewer header (mirrors the real memory.md
// locations so it reads familiarly, like the docs surface).
function selPath(s: Sel): string {
  // The notebook is NOT under the project — it is global to the super-agent.
  // Showing its real absolute-ish path is the whole point: the confusion this
  // entry fixes was not knowing where it lived. Same reasoning for the local
  // file: "not in the repo" is a property you have to be able to SEE.
  switch (s.kind) {
    case "notebook": return "~/.apx/memory.md";
    case "project":  return ".apc/memory.md";
    case "local":    return "~/.apx/projects/<id>/memory.md";
    default:         return `~/.apx/projects/<id>/agents/${s.slug}/memory.md`;
  }
}

function loadBody(pid: string, s: Sel): Promise<string> {
  switch (s.kind) {
    case "notebook": return Notebook.get().then((r) => r.body);
    case "project":  return Projects.memory.get(pid).then((r) => r.body);
    case "local":    return Projects.memory.local.get(pid).then((r) => r.body);
    default:         return Agents.memory.get(pid, s.slug).then((r) => r.body);
  }
}

function saveBody(pid: string, s: Sel, body: string): Promise<void> {
  switch (s.kind) {
    case "notebook": return Notebook.put(body).then(() => {});
    case "project":  return Projects.memory.put(pid, body).then(() => {});
    case "local":    return Projects.memory.local.put(pid, body).then(() => {});
    default:         return Agents.memory.put(pid, s.slug, body).then(() => {});
  }
}

function SidebarItem({
  active, onClick, icon: Icon, iconClass, label, sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  iconClass?: string;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[13px]",
        active ? "bg-primary/15 text-foreground" : "text-foreground/80 hover:bg-accent/40",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", iconClass ?? "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {sub && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  );
}

// Docs-style two-pane browser for durable memory: a sidebar listing the project
// ("General") memory plus every agent's memory, and the shared FileViewer on the
// right for markdown edit / split-preview / save — the same surface as /docs.
export function MemoryBrowser({ pid }: { pid: string }) {
  const toast = useToast();
  // The notebook belongs to Base (id 0) and to nowhere else. It is ONE global
  // file (~/.apx/memory.md) that used to head the sidebar of every project, so
  // twelve projects each looked like they owned a copy of the super-agent's
  // memory — and editing it "in Postbeam" silently edited the global one.
  const isBase = String(pid) === "0";
  // What opens first is what is most likely to have something in it. On Base
  // that is the notebook (the memory that ships in every prompt on every
  // channel); on a project it is the internal memory, because that is where
  // everything the agent has learned lands — opening on the curated file meant
  // opening on an empty pane and having to go looking, which is the exact
  // feeling this screen exists to remove.
  const fallback: Sel = isBase ? { kind: "notebook" } : { kind: "local" };
  const [sel, setSel] = useState<Sel | null>(null);
  // Switching projects from the rail re-renders this component without
  // remounting it, so a notebook selection can outlive Base. Derive rather than
  // reset: off Base there is simply no such row to be on.
  const open: Sel = !sel || (!isBase && sel.kind === "notebook") ? fallback : sel;
  const notebook = useSWR(isBase ? "/api/notebook" : null, () => Notebook.get());
  // Never hardcode the agent's name (AGENTS.md rule 13) — it is the user's to set.
  const persona = usePersonaName();

  const agents = useSWR(`/api/projects/${pid}/agents`, () => Agents.list(pid));

  const bodyKey = `/api/memory/${pid}/${selId(open)}`;
  const body = useSWR(bodyKey, () => loadBody(pid, open));

  // Adapt the raw memory body into the FileContent shape FileViewer expects.
  const file = useMemo<FileContent | null>(() => {
    if (body.data === undefined) return null;
    const content = body.data ?? "";
    return {
      path: selPath(open),
      name: "memory.md",
      kind: "markdown",
      size: content.length,
      modified: "",
      encoding: "utf8",
      content,
    };
  }, [body.data, open]);

  const onSave = async (content: string) => {
    await saveBody(pid, open, content);
    toast.success(t("project.memories.saved"));
    void body.mutate(content, { revalidate: false });
  };

  const list = (agents.data || []) as AgentEntry[];

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Brain className="size-4 text-muted-foreground" />
          <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("project.memories.sidebar_title")}
          </span>
          <button
            type="button"
            onClick={() => { void agents.mutate(); void body.mutate(); }}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("common.refresh")}
          >
            <RefreshCw className={agents.isValidating ? "size-3.5 animate-spin" : "size-3.5"} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {/* The super-agent's own notebook — Base only. First, and in its own
              group, because it is global rather than a property of a project,
              and its absence from every list is what made "where is the
              super-agent's memory?" an unanswerable question. */}
          {isBase && (
            <>
              <p className="px-1.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("project.memories.super_agent_group")}
              </p>
              <SidebarItem
                active={open.kind === "notebook"}
                onClick={() => setSel({ kind: "notebook" })}
                icon={NotebookPen}
                iconClass={toneText.emerald}
                label={t("project.memories.notebook_item", { persona })}
                sub={notebook.data ? t("project.memories.tokens", { n: notebook.data.approx_tokens }) : undefined}
              />
            </>
          )}

          {/* General / project memory */}
          <p className={`px-1.5 pb-1 ${isBase ? "pt-3" : "pt-1"} text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
            {t("project.memories.general_group")}
          </p>
          {/* The agent's half, first because it is the one that fills up: what
              `remember` writes lands here, so a fact picked up mid-chat cannot
              put a pasted credential into the repo's history. Promotion to
              .apc/memory.md is a person copying a line they have read. */}
          <SidebarItem
            active={open.kind === "local"}
            onClick={() => setSel({ kind: "local" })}
            icon={BrainCircuit}
            iconClass={toneText.amber}
            label={t("project.memories.local_item")}
            sub={t("project.memories.not_committed")}
          />
          <SidebarItem
            active={open.kind === "project"}
            onClick={() => setSel({ kind: "project" })}
            icon={Brain}
            iconClass={toneText.sky}
            label={t("project.memories.general_item")}
            sub={t("project.memories.committed")}
          />

          {/* Agent memories */}
          <p className="px-1.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("project.memories.agents_title")}
          </p>
          {agents.isLoading ? (
            <div className="flex justify-center py-4"><Spinner size={14} /></div>
          ) : list.length === 0 ? (
            <div className="px-1.5 py-2">
              <Empty icon={Brain}>{t("project.memories.no_agents")}</Empty>
            </div>
          ) : (
            list.map((a) => (
              <SidebarItem
                key={a.slug}
                active={open.kind === "agent" && open.slug === a.slug}
                onClick={() => setSel({ kind: "agent", slug: a.slug })}
                icon={a.is_master ? Crown : Bot}
                iconClass={a.is_master ? toneText.violet : "text-muted-foreground"}
                label={a.slug}
                sub={a.role || undefined}
              />
            ))
          )}
        </div>
      </div>

      {/* Viewer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <FileViewer file={file} loading={body.isLoading} onSave={onSave} />
      </div>
    </div>
  );
}
