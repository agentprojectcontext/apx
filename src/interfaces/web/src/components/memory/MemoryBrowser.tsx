import { useMemo, useState } from "react";
import useSWR from "swr";
import { Brain, Bot, Crown, RefreshCw } from "lucide-react";
import { Agents, Projects } from "../../lib/api";
import type { AgentEntry, FileContent } from "../../types/daemon";
import { cn } from "../../lib/cn";
import { Spinner, Empty } from "../ui";
import { useToast } from "../Toast";
import { t } from "../../i18n";
import { FileViewer } from "../files/FileViewer";

// Which memory is open in the right pane.
type Sel = { kind: "project" } | { kind: "agent"; slug: string };

function selId(s: Sel): string {
  return s.kind === "project" ? "project" : `agent:${s.slug}`;
}

// On-disk-ish path shown in the viewer header (mirrors the real memory.md
// locations so it reads familiarly, like the docs surface).
function selPath(s: Sel): string {
  return s.kind === "project" ? ".apc/memory.md" : `agents/${s.slug}/memory.md`;
}

function loadBody(pid: string, s: Sel): Promise<string> {
  return s.kind === "project"
    ? Projects.memory.get(pid).then((r) => r.body)
    : Agents.memory.get(pid, s.slug).then((r) => r.body);
}

function saveBody(pid: string, s: Sel, body: string): Promise<void> {
  return s.kind === "project"
    ? Projects.memory.put(pid, body).then(() => {})
    : Agents.memory.put(pid, s.slug, body).then(() => {});
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
  const [sel, setSel] = useState<Sel>({ kind: "project" });

  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));

  const bodyKey = `/memory/${pid}/${selId(sel)}`;
  const body = useSWR(bodyKey, () => loadBody(pid, sel));

  // Adapt the raw memory body into the FileContent shape FileViewer expects.
  const file = useMemo<FileContent | null>(() => {
    if (body.data === undefined) return null;
    const content = body.data ?? "";
    return {
      path: selPath(sel),
      name: "memory.md",
      kind: "markdown",
      size: content.length,
      modified: "",
      encoding: "utf8",
      content,
    };
  }, [body.data, sel]);

  const onSave = async (content: string) => {
    await saveBody(pid, sel, content);
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
          {/* General / project memory */}
          <p className="px-1.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {t("project.memories.general_group")}
          </p>
          <SidebarItem
            active={sel.kind === "project"}
            onClick={() => setSel({ kind: "project" })}
            icon={Brain}
            iconClass="text-sky-500"
            label={t("project.memories.general_item")}
          />

          {/* Agent memories */}
          <p className="px-1.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {t("project.memories.agents_title")}
          </p>
          {agents.isLoading ? (
            <div className="flex justify-center py-4"><Spinner size={14} /></div>
          ) : list.length === 0 ? (
            <div className="px-1.5 py-2">
              <Empty>{t("project.memories.no_agents")}</Empty>
            </div>
          ) : (
            list.map((a) => (
              <SidebarItem
                key={a.slug}
                active={sel.kind === "agent" && sel.slug === a.slug}
                onClick={() => setSel({ kind: "agent", slug: a.slug })}
                icon={a.is_master ? Crown : Bot}
                iconClass={a.is_master ? "text-violet-400" : "text-muted-foreground"}
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
