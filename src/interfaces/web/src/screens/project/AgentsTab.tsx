import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { Activity, Bot, Crown, Eye, GitBranch, Heart, List, MessagesSquare, Plus, Send, Sparkles, Upload, Wrench, Zap } from "lucide-react";
import { Agents } from "../../lib/api";
import type { AgentEntry, AgentStats } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { Tip } from "../../components/ui/tip";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { AutonomyPicker, AreaRoleFields, AgentIconPicker } from "../../components/agents/AgentFormFields";
import { AgentModelSelect } from "../../components/agents/AgentModelSelect";
import { AgentModelBadge } from "../../components/agents/AgentModelBadge";
import { INHERIT_MODEL, isInheritedModel } from "../../components/agents/modelCatalog";
import { BlobAvatar } from "../../components/agents/BlobAvatar";
import { isBlobKey } from "../../components/agents/blobPresets";
import { cn } from "../../lib/cn";
import { slugify } from "../../lib/slug";
import { t } from "../../i18n";
import { toneText, toneTextHover } from "../../lib/tone";
import type { AgentAutonomy } from "../../types/daemon";
import { typeOptions } from "./AgentDetailScreen";

const LANGS = ["", "es", "en", "pt", "fr", "it", "de"];
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function agentVisual(a: AgentEntry) {
  return a.is_master
    ? { gradient: "from-violet-600 to-indigo-600", Icon: Crown }
    : { gradient: "from-slate-600 to-gray-600", Icon: Bot };
}

// Icon + count summary (threads / records / tasks / heartbeats) mirroring the
// agent Explorer, with an i18n tooltip on each so the icons are self-describing.
const STAT_META: { key: keyof AgentStats; icon: typeof Bot; i18n: Parameters<typeof t>[0] }[] = [
  { key: "threads",    icon: MessagesSquare, i18n: "agents_ui.stat_threads" },
  { key: "records",    icon: Activity,       i18n: "agents_ui.stat_records" },
  { key: "tasks",      icon: Zap,            i18n: "agents_ui.stat_tasks" },
  { key: "heartbeats", icon: Heart,          i18n: "agents_ui.stat_heartbeats" },
];

function AgentStatRow({ stats, className }: { stats?: AgentStats; className?: string }) {
  if (!stats) return null;
  return (
    <div className={cn("flex items-center gap-3 text-[11px] text-muted-fg", className)}>
      {STAT_META.map(({ key, icon: I, i18n }) => (
        <Tip key={key} content={t(i18n)}>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <I size={12} /> {stats[key]}
          </span>
        </Tip>
      ))}
    </div>
  );
}

// Canonical area key. Agents historically stored the display name (`Growth`)
// while the org chart uses the slug (`growth`); grouping by the raw string
// split one area into two pills that looked identical (CSS uppercase).
function areaKey(area: string | null | undefined): string | null {
  if (!area) return null;
  return slugify(area) || area;
}

// Group agents by their area (category). Named areas sort alphabetically;
// uncategorized agents fall to the end.
function groupByArea(agents: AgentEntry[]): { area: string | null; agents: AgentEntry[] }[] {
  const map = new Map<string | null, AgentEntry[]>();
  for (const a of agents) {
    const k = areaKey(a.area);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([area, agents]) => ({ area, agents }));
}

// How many columns a group of N sibling agents packs into: 1, 1×2, 2×2, 2×3,
// 3×3… — keeps a group squarish instead of one tall column or one wide row.
function siblingGridCols(n: number): number {
  if (n <= 2) return n;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

// Sibling agents inside one area. Columns are `max-content` (never fr), so a
// group is only as wide as its cards and can't squash them when it sits beside
// other areas.
function AgentGrid({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div
      className="grid items-start justify-items-center gap-x-5 gap-y-8"
      style={{ gridTemplateColumns: `repeat(${siblingGridCols(count)}, max-content)` }}
    >
      {children}
    </div>
  );
}

// Build parent→children map with panda's single-orchestrator fallback: if there
// is exactly one master and an agent has no explicit parent, treat it as a child.
function buildTree(agents: AgentEntry[]) {
  const masters = agents.filter((a) => a.is_master);
  const soleMaster = masters.length === 1 ? masters[0] : null;
  const parentOf = (a: AgentEntry): string | null => {
    if (a.parent) return a.parent;
    if (soleMaster && !a.is_master && a.slug !== soleMaster.slug) return soleMaster.slug;
    return null;
  };
  const childrenByParent = new Map<string, AgentEntry[]>();
  const roots: AgentEntry[] = [];
  for (const a of agents) {
    const p = parentOf(a);
    if (p && agents.some((x) => x.slug === p)) {
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(a);
    } else {
      roots.push(a);
    }
  }
  return { roots, childrenByParent };
}

export function AgentsTab({ pid }: { pid: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const list = useSWR(`/api/projects/${pid}/agents?stats=1`, () => Agents.list(pid, { stats: true }));
  const [view, setView] = useState<"hierarchy" | "list">("hierarchy");
  const [creating, setCreating] = useState(false);

  const [importing, setImporting] = useState(false);
  const agents = list.data || [];
  const open = (slug: string) => navigate(`/p/${pid}/agents/${slug}`);
  const chat = (slug?: string) => navigate(slug ? `/p/${pid}/chat?agent=${slug}` : `/p/${pid}/chat`);
  const { roots, childrenByParent } = useMemo(() => buildTree(agents), [agents]);

  return (
    <Section
      title={t("project.agents.title")}
      description={t("project.agents.subtitle_full")}
      action={
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            <button onClick={() => setView("hierarchy")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-xs", view === "hierarchy" ? "bg-accent text-accent-fg" : "text-muted-fg")}>
              <GitBranch size={13} /> {t("project.agents.hierarchy")}
            </button>
            <button onClick={() => setView("list")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-xs", view === "list" ? "bg-accent text-accent-fg" : "text-muted-fg")}>
              <List size={13} /> {t("project.agents.list_view")}
            </button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
            <Upload size={13} /> {t("project.agents.import")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => chat()}><Send size={13} /> {t("project.agents.chat")}</Button>
          <Button size="sm" variant="primary" data-testid="agent-new" onClick={() => setCreating(true)}><Plus size={14} /> {t("project.agents.new")}</Button>
        </div>
      }
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && agents.length === 0 && (
        <Empty icon={Bot}>{t("project.agents.empty_text")}</Empty>
      )}

      {!list.isLoading && agents.length > 0 && (
        view === "hierarchy"
          ? <HierarchyView pid={pid} roots={roots} childrenByParent={childrenByParent} onOpen={open} onChat={chat} onAgentSaved={() => list.mutate()} />
          : <ListView agents={agents} onOpen={open} onChat={chat} />
      )}

      <CreateAgentDialog
        open={creating}
        pid={pid}
        agents={agents}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); list.mutate(); }}
      />
      <ImportVaultDialog
        open={importing}
        pid={pid}
        existing={agents.map((a) => a.slug)}
        onClose={() => setImporting(false)}
        onImported={() => list.mutate()}
      />
    </Section>
  );
}

function ImportVaultDialog({
  open, onClose, onImported, pid, existing,
}: { open: boolean; onClose: () => void; onImported: () => void; pid: string; existing: string[] }) {
  const toast = useToast();
  const vault = useSWR(open ? "/api/agents/vault" : null, () => Agents.vault());
  const [busy, setBusy] = useState("");
  const items = vault.data || [];

  const doImport = async (slug: string) => {
    setBusy(slug);
    try { await Agents.import(pid, slug); toast.success(t("project.agents.import_success", { slug })); onImported(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("project.agents.import_title")}
      description={t("project.agents.import_desc")}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
    >
      {vault.isLoading && <Loading />}
      {!vault.isLoading && items.length === 0 && <Empty icon={Upload}>{t("project.agents.import_empty")}</Empty>}
      <ul className="space-y-2">
        {items.map((a) => {
          const already = existing.includes(a.slug);
          return (
            <li key={a.slug} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Bot size={16} className="shrink-0 text-muted-fg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{a.slug}</span>
                  {a.is_master && <Badge tone="success"><Crown size={9} /> {t("project.agents.orchestrator")}</Badge>}
                  {a.model && <Badge tone="info">{a.model}</Badge>}
                </div>
                {a.description && <p className="truncate text-xs text-muted-fg">{a.description}</p>}
              </div>
              <Button size="sm" variant="primary" disabled={already || busy === a.slug} loading={busy === a.slug} onClick={() => doImport(a.slug)}>
                {already ? t("project.agents.import_already") : t("project.agents.import_btn")}
              </Button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

// Real connector lines for the hierarchy: cards stay in normal (fixed) flow
// layout, and an SVG overlay behind them draws animated bezier edges from each
// parent's bottom edge to each child's top edge. Positions are measured from
// the DOM (ResizeObserver), so the lines always land on the cards regardless
// of wrapping or category grouping — no graph library, matching the hand-built
// d3+SVG approach of AgentBrainGraph.
const EDGE_COLOR = "#34d399"; // emerald — APX brand accent
const EDGE_ROOT_COLOR = "#a78bfa"; // violet — edges leaving an orchestrator

interface EdgePath { key: string; d: string; color: string; dur: string; begin: string }

function HierarchyEdges({ paths }: { paths: EdgePath[] }) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <filter id="agent-edge-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {paths.map((p) => (
        <g key={p.key}>
          {/* soft glow under the line */}
          <path d={p.d} fill="none" stroke={p.color} strokeWidth={4} opacity={0.18} filter="url(#agent-edge-glow)" />
          {/* animated dotted line (marching ants) */}
          <path d={p.d} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="1.5 7" opacity={0.75}>
            <animate attributeName="stroke-dashoffset" from="17" to="0" dur="1.4s" repeatCount="indefinite" />
          </path>
          {/* energy pulse travelling parent → child */}
          <circle r={4.5} fill={p.color} opacity={0.25} filter="url(#agent-edge-glow)">
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" path={p.d} />
          </circle>
          <circle r={2} fill={p.color} opacity={0.9}>
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" path={p.d} />
          </circle>
        </g>
      ))}
    </svg>
  );
}

function HierarchyView({
  pid, roots, childrenByParent, onOpen, onChat, onAgentSaved,
}: {
  pid: string;
  roots: AgentEntry[];
  childrenByParent: Map<string, AgentEntry[]>;
  onOpen: (slug: string) => void;
  onChat: (slug: string) => void;
  onAgentSaved: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [paths, setPaths] = useState<EdgePath[]>([]);

  const edges = useMemo(() => {
    const out: { from: string; to: string; fromMaster: boolean }[] = [];
    const walk = (node: AgentEntry) => {
      for (const child of childrenByParent.get(node.slug) || []) {
        out.push({ from: node.slug, to: child.slug, fromMaster: !!node.is_master });
        walk(child);
      }
    };
    for (const root of roots) walk(root);
    return out;
  }, [roots, childrenByParent]);

  const setNodeRef = (slug: string) => (el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(slug, el);
    else nodeRefs.current.delete(slug);
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const compute = () => {
      const base = container.getBoundingClientRect();
      const next: EdgePath[] = [];
      edges.forEach((e, i) => {
        const a = nodeRefs.current.get(e.from)?.getBoundingClientRect();
        const b = nodeRefs.current.get(e.to)?.getBoundingClientRect();
        if (!a || !b) return;
        const x1 = a.left + a.width / 2 - base.left;
        const y1 = a.bottom - base.top;
        const x2 = b.left + b.width / 2 - base.left;
        const y2 = b.top - base.top;
        const bend = Math.min(Math.max((y2 - y1) * 0.6, 24), 90);
        next.push({
          key: `${e.from}->${e.to}`,
          d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
          color: e.fromMaster ? EDGE_ROOT_COLOR : EDGE_COLOR,
          dur: `${(2.8 + (i % 5) * 0.4).toFixed(1)}s`,
          begin: `${((i * 0.5) % 2.5).toFixed(1)}s`,
        });
      });
      setPaths(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    nodeRefs.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [edges]);

  return (
    <div ref={containerRef} className="relative">
      <HierarchyEdges paths={paths} />
      <div className="relative z-10 space-y-12">
        {roots.map((root) => (
          <HierarchyBranch
            key={root.slug}
            pid={pid}
            agent={root}
            depth={0}
            childrenByParent={childrenByParent}
            setNodeRef={setNodeRef}
            onOpen={onOpen}
            onChat={onChat}
            onAgentSaved={onAgentSaved}
          />
        ))}
      </div>
    </div>
  );
}

function AreaPill({ area, count }: { area: string | null; count: number }) {
  return (
    <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-fg">
      {area || t("agents_ui.uncategorized")} · {count}
    </span>
  );
}

// One agent + its descendants. Areas sit side by side in one row; the agents
// of each area pack into their own compact grid. Parent→child links grow down.
function HierarchyBranch({
  pid, agent, depth, childrenByParent, setNodeRef, onOpen, onChat, onAgentSaved,
}: {
  pid: string;
  agent: AgentEntry;
  depth: number;
  childrenByParent: Map<string, AgentEntry[]>;
  setNodeRef: (slug: string) => (el: HTMLDivElement | null) => void;
  onOpen: (slug: string) => void;
  onChat: (slug: string) => void;
  onAgentSaved: () => void;
}) {
  const kids = childrenByParent.get(agent.slug) || [];
  const groups = groupByArea(kids);
  const categorized = groups.some((g) => g.area);

  return (
    <div className="flex flex-col items-center">
      <div ref={setNodeRef(agent.slug)}>
        <AgentCard
          pid={pid}
          agent={agent}
          onOpen={onOpen}
          onChat={onChat}
          onModelSaved={onAgentSaved}
          wide={depth === 0}
          compact={depth >= 2}
        />
      </div>
      {kids.length > 0 && (
        categorized ? (
          <div className="mt-12 flex flex-row flex-wrap items-start justify-center gap-x-10 gap-y-12">
            {groups.map((g) => (
              <div key={g.area ?? "__none"} className="flex flex-col items-center gap-3">
                <AreaPill area={g.area} count={g.agents.length} />
                <AgentGrid count={g.agents.length}>
                  {g.agents.map((k) => (
                    <HierarchyBranch
                      key={k.slug}
                      pid={pid}
                      agent={k}
                      depth={depth + 1}
                      childrenByParent={childrenByParent}
                      setNodeRef={setNodeRef}
                      onOpen={onOpen}
                      onChat={onChat}
                      onAgentSaved={onAgentSaved}
                    />
                  ))}
                </AgentGrid>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-12">
            <AgentGrid count={kids.length}>
              {kids.map((k) => (
                <HierarchyBranch
                  key={k.slug}
                  pid={pid}
                  agent={k}
                  depth={depth + 1}
                  childrenByParent={childrenByParent}
                  setNodeRef={setNodeRef}
                  onOpen={onOpen}
                  onChat={onChat}
                  onAgentSaved={onAgentSaved}
                />
              ))}
            </AgentGrid>
          </div>
        )
      )}
    </div>
  );
}

function AgentCard({
  pid, agent, onOpen, onChat, onModelSaved, wide, compact,
}: {
  pid: string;
  agent: AgentEntry;
  onOpen: (slug: string) => void;
  onChat: (slug: string) => void;
  onModelSaved: () => void;
  wide?: boolean;
  compact?: boolean;
}) {
  const { gradient, Icon } = agentVisual(agent);
  return (
    <div
      data-testid={`agent-card-${agent.slug}`}
      className={cn(
        "cursor-pointer rounded-xl border border-border bg-card p-3 transition-colors hover:border-muted-fg/50",
        wide ? "w-64" : compact ? "w-44" : "w-52",
      )}
      onClick={() => onOpen(agent.slug)}
    >
      <div className="flex items-center gap-2">
        {isBlobKey(agent.icon) ? (
          <BlobAvatar preset={agent.icon} size={32} seed={agent.slug} className="shrink-0" />
        ) : (
          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br", gradient)}>
            {agent.emoji ? <span className="text-base leading-none">{agent.emoji}</span> : <Icon className="size-4 text-white" />}
          </div>
        )}
        {/* Name is what the agent is CALLED; the slug is its immutable handle
            (filename, delegation, a2a ids), kept as a small subtitle when it
            differs so both are visible. */}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{agent.name || agent.slug}</span>
          {agent.name && agent.name !== agent.slug && (
            <span className="block truncate text-[10px] leading-tight text-muted-fg">{agent.slug}</span>
          )}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {agent.is_master && <Badge tone="success"><Crown size={9} /> {t("project.agents.orchestrator")}</Badge>}
        {agent.role && <Badge>{agent.role}</Badge>}
      </div>
      <AgentStatRow stats={agent.stats} className="mt-2" />
      {/* The model badge closes this row: it only gets the width left over by
          View/Chat and truncates, so a long id can't widen the card. */}
      <div className="mt-2 flex items-center gap-3 border-t border-border pt-2 text-xs text-muted-fg" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onOpen(agent.slug)} className="flex shrink-0 items-center gap-1 hover:text-foreground"><Eye size={12} /> {t("project.agents.view")}</button>
        <button onClick={() => onChat(agent.slug)} className={`flex shrink-0 items-center gap-1 ${toneText.emerald} ${toneTextHover.emerald}`}><Send size={12} /> {t("project.agents.chat")}</button>
        <AgentModelBadge
          pid={pid}
          slug={agent.slug}
          model={agent.model}
          onSaved={onModelSaved}
          className="ml-auto"
        />
      </div>
    </div>
  );
}

function ListView({ agents, onOpen, onChat }: { agents: AgentEntry[]; onOpen: (slug: string) => void; onChat: (slug: string) => void }) {
  const sorted = [...agents].sort((a, b) => Number(!!b.is_master) - Number(!!a.is_master) || a.slug.localeCompare(b.slug));
  return (
    <div className="space-y-2">
      {sorted.map((a) => {
        const { gradient, Icon } = agentVisual(a);
        return (
          <div key={a.slug} data-testid={`agent-card-${a.slug}`} className="flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-muted/30 p-3 hover:border-muted-fg/50" onClick={() => onOpen(a.slug)}>
            {isBlobKey(a.icon) ? (
              <BlobAvatar preset={a.icon} size={36} seed={a.slug} className="shrink-0" />
            ) : (
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", gradient)}>
                {a.emoji ? <span className="text-lg leading-none">{a.emoji}</span> : <Icon className="size-4 text-white" />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{a.name || a.slug}</span>
                {a.name && a.name !== a.slug && <span className="text-[10px] text-muted-fg">{a.slug}</span>}
                {a.is_master && <Badge tone="success"><Crown size={10} /> {t("project.agents.orchestrator")}</Badge>}
                {a.role && <Badge>{a.role}</Badge>}
                {a.model && <Badge tone="info">{a.model}</Badge>}
                {a.parent && <span className={`text-[10px] ${toneText.violet}`}>↳ {a.parent}</span>}
              </div>
              {a.description && <p className="mt-1 truncate text-xs text-muted-fg">{a.description}</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                {a.skills?.map((s) => <span key={s} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Sparkles size={9} /> {s}</span>)}
                {a.tools?.map((tl) => <span key={tl} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Wrench size={9} /> {tl}</span>)}
              </div>
            </div>
            <AgentStatRow stats={a.stats} className="hidden shrink-0 sm:flex" />
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-fg" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onOpen(a.slug)} className="flex items-center gap-1 hover:text-foreground"><Eye size={12} /> {t("project.agents.view")}</button>
              <button onClick={() => onChat(a.slug)} className={`flex items-center gap-1 ${toneText.emerald} ${toneTextHover.emerald}`}><Send size={12} /> {t("project.agents.chat")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateAgentDialog({
  open, onClose, onCreated, pid, agents,
}: { open: boolean; onClose: () => void; onCreated: () => void; pid: string; agents: AgentEntry[] }) {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [type, setType] = useState("");
  const [role, setRole] = useState("");
  const [area, setArea] = useState("");
  const [autonomy, setAutonomy] = useState<AgentAutonomy | "">("");
  const [model, setModel] = useState(INHERIT_MODEL);
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [system, setSystem] = useState("");
  const [isMaster, setIsMaster] = useState(false);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSlug(""); setName(""); setIcon(""); setType(""); setRole(""); setArea(""); setAutonomy("");
    setModel(INHERIT_MODEL); setLanguage(""); setDescription(""); setSystem("");
    setIsMaster(false); setParent("");
  };

  const submit = async () => {
    if (!/^[a-z][a-z0-9_-]*$/.test(slug)) { toast.error(t("project.agents.slug_invalid")); return; }
    setBusy(true);
    try {
      // Skills and tools are deliberately absent: a new agent inherits the
      // project's enabled skills and the daemon's default tool set, then gets
      // tuned in the agent's Config tab.
      await Agents.create(pid, {
        slug,
        name: name || undefined,
        icon: icon || undefined,
        type: type || undefined,
        role: role || undefined,
        area: area || undefined,
        autonomy: autonomy || undefined,
        model: isInheritedModel(model) ? INHERIT_MODEL : model,
        language: language || undefined,
        description: description || undefined,
        system: system || undefined,
        is_master: isMaster || type === "orchestrator",
        parent: parent || undefined,
      });
      toast.success(t("project.agents.create_success", { slug }));
      onCreated();
      reset();
    } catch (e: any) { toast.error(e?.message || t("project.agents.create_error")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("project.agents.new_title")}
      description={t("project.agents.new_desc")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" data-testid="agent-create-submit" onClick={submit} loading={busy}>{t("common.create")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("agents_form.name")} hint={t("agents_form.name_hint")}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("agents_form.name_ph")} />
          </Field>
          <Field label={t("project.agents.slug_label")} hint={t("agents_form.slug_hint")}>
            <Input data-testid="agent-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t("project.agents.slug_ph")} />
          </Field>
        </div>
        <Field label={t("project.agents.desc_label")}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("project.agents.desc_ph")} />
        </Field>
        <Field label={t("project.agent_detail.system_label")} hint={t("project.agent_detail.system_hint")}>
          <Textarea rows={8} className="font-mono text-xs" value={system} onChange={(e) => setSystem(e.target.value)} placeholder="You are…" />
        </Field>
        <Field label={t("agents_form.icon")}>
          <AgentIconPicker icon={icon} onIcon={setIcon} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("project.agent_detail.type_label")}><UiSelect value={type} onChange={setType} options={typeOptions()} /></Field>
          <Field label={t("project.agents.lang_label")}><UiSelect value={language} onChange={setLanguage} options={LANGS.map((l) => ({ value: l, label: l || "—" }))} /></Field>
        </div>
        <AreaRoleFields pid={pid} area={area} role={role} onArea={setArea} onRole={setRole} />
        <Field label={t("agents_form.autonomy")} hint={t("agents_form.autonomy_hint")}>
          <AutonomyPicker value={autonomy} onChange={setAutonomy} />
        </Field>
        <Field label={t("project.agents.model_label")} hint={t("project.agents.model_hint")}>
          <AgentModelSelect value={model} onChange={setModel} />
        </Field>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label={t("project.agents.parent_label")} hint={t("project.agents.parent_hint")}>
            <UiSelect
              value={parent}
              onChange={setParent}
              placeholder={t("project.agents.none_parent")}
              options={[{ value: "", label: t("project.agents.none_parent") }, ...agents.filter((a) => a.slug !== slug).map((a) => ({ value: a.slug, label: a.slug }))]}
            />
          </Field>
          <Switch checked={isMaster} onChange={setIsMaster} label={t("project.agents.master_label")} />
        </div>
        <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-fg">
          {t("agents_form.create_defaults_note")}
        </p>
      </div>
    </Dialog>
  );
}
