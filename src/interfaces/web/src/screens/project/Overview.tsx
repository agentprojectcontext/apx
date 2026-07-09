import { useMemo } from "react";
import useSWR from "swr";
import { NavLink, useNavigate } from "react-router-dom";
import { Bot, Briefcase, FileCode2, Heart, MessagesSquare, Puzzle, Zap, Crown, Activity } from "lucide-react";
import { Agents, Artifacts, Mcps, Routines, Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { StatusIcon, StatusBadge, effectiveStatus, statusLabel, TASK_STATUS_ORDER } from "../../components/tasks/taskStatus";
import { BrainGraph, type BrainNode, type BrainEdge } from "./AgentBrainGraph";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { AgentEntry } from "../../types/daemon";

// Floor / mission control: a live per-project summary — what's here (agents,
// automation), what's in flight (task workflow), and what just happened.
export function Overview({ pid }: { pid: string }) {
  const navigate = useNavigate();
  const tasks    = useSWR(`/projects/${pid}/tasks?state=open`, () => Tasks.list(pid), { refreshInterval: 20_000 });
  const summary  = useSWR(`/projects/${pid}/tasks-summary`,    () => Tasks.summary(pid), { refreshInterval: 20_000 });
  const routines = useSWR(`/projects/${pid}/routines`,         () => Routines.list(pid));
  const agents   = useSWR(`/projects/${pid}/agents`,           () => Agents.list(pid));
  const mcps     = useSWR(`/projects/${pid}/mcps`,             () => Mcps.list(pid));
  const artifacts = useSWR(`/projects/${pid}/artifacts`,       () => Artifacts.list(pid));

  const agentList = agents.data ?? [];
  const orchestrators = agentList.filter((a) => a.is_master || a.type === "orchestrator");
  const specialists = agentList.filter((a) => !(a.is_master || a.type === "orchestrator"));
  // When agents carry an area, the project reads as a company: group the roster
  // by area instead of the flat orchestrator/specialist split.
  const areaGroups = groupByArea(agentList);
  const hasAreas = areaGroups.some((g) => g.area);
  const activeRoutines = (routines.data ?? []).filter((r) => r.enabled).length;
  const openTasks = [...(tasks.data ?? [])].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title={t("project.overview.agents")}     value={agentList.length}          href={`/p/${pid}/agents`}   icon={Bot} />
        <Card title={t("project.overview.tasks_open")}  value={summary.data?.open ?? tasks.data?.length ?? "…"} href={`/p/${pid}/tasks`} icon={Zap} />
        <Card title={t("project.overview.routines_active")} value={activeRoutines} href={`/p/${pid}/routines`} icon={Heart} />
        <Card title={t("project.overview.artifacts")}   value={artifacts.data?.length ?? "…"} href={`/p/${pid}/artifacts`} icon={FileCode2} />
      </div>

      {/* Task workflow strip — always shown once the summary loads, so every
          status reads at least 0 (parity with the base dashboard). */}
      {summary.data && (
        <div className="flex flex-wrap gap-2">
          {TASK_STATUS_ORDER.map((s) => (
            <NavLink
              key={s}
              to={`/p/${pid}/tasks`}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent/40"
            >
              <StatusIcon status={s} className="size-3.5" />
              <span className="capitalize text-muted-foreground">{statusLabel(s)}</span>
              <span className="font-semibold">{summary.data!.status?.[s] ?? 0}</span>
            </NavLink>
          ))}
        </div>
      )}

      {/* Team brain — the whole agent map: orchestrators at the core, their
          specialists clustered around them as satellites, all connected. */}
      {agentList.length > 0 && (
        <Section title={t("project.overview.brain_title")} description={t("project.overview.brain_desc")} className="!p-4">
          <TeamBrain pid={pid} agents={agentList} navigate={navigate} />
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Agent roster */}
        <Section title={t("project.overview.roster")} className="!p-4">
          {agentList.length === 0 ? (
            <p className="text-sm text-muted-fg">{t("project.overview.no_agents")}</p>
          ) : hasAreas ? (
            <div className="space-y-3">
              {areaGroups.map((g) => (
                <RosterRow
                  key={g.area ?? "__none"}
                  label={g.area || t("agents_ui.uncategorized")}
                  icon={Briefcase}
                  agents={g.agents}
                  pid={pid}
                  navigate={navigate}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {orchestrators.length > 0 && (
                <RosterRow label={t("project.overview.orchestrators")} icon={Crown} agents={orchestrators} pid={pid} navigate={navigate} />
              )}
              {specialists.length > 0 && (
                <RosterRow label={t("project.overview.specialists")} icon={Bot} agents={specialists} pid={pid} navigate={navigate} />
              )}
            </div>
          )}
        </Section>

        {/* Recent / in-flight tasks */}
        <Section title={t("project.overview.recent_tasks")} className="!p-4"
          action={<NavLink to={`/p/${pid}/tasks`} className="text-xs text-sky-500 hover:text-sky-400">{t("common.view_all")}</NavLink>}
        >
          {openTasks.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-fg"><Activity className="size-4" />{t("project.overview.no_activity")}</p>
          ) : (
            <ul className="space-y-1.5">
              {openTasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/p/${pid}/tasks?task=${task.id}`)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/40"
                  >
                    <StatusIcon status={effectiveStatus(task)} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <StatusBadge status={effectiveStatus(task)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Card title={t("project.overview.chat")} value={t("project.overview.chat_value")} href={`/p/${pid}/chat`} icon={MessagesSquare} />
        <Card title={t("project.overview.mcps")} value={mcps.data?.length ?? "…"} href={`/p/${pid}/mcps`} icon={Puzzle} />
        <Card title={t("project.overview.routines")} value={routines.data?.length ?? "…"} href={`/p/${pid}/routines`} icon={Heart} />
      </div>
    </div>
  );
}

// Group agents by area (category); named areas first (alphabetical), the
// uncategorized bucket last.
function groupByArea(agents: AgentEntry[]): { area: string | null; agents: AgentEntry[] }[] {
  const map = new Map<string | null, AgentEntry[]>();
  for (const a of agents) {
    const k = a.area || null;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([area, agents]) => ({ area, agents }));
}

// Whole-project agent map. The core is the team; orchestrators hang off it as
// hubs, and each specialist connects to its parent orchestrator (or the core if
// unparented) — so teams read as satellite clusters. Click a node to open it.
function TeamBrain({
  pid, agents, navigate,
}: {
  pid: string; agents: AgentEntry[]; navigate: (to: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: BrainNode[] = [];
    const edges: BrainEdge[] = [];
    const ROOT = "__root";
    nodes.push({ id: ROOT, label: t("project.overview.brain_core"), kind: "agent", role: "core", emoji: "🧠" });

    const slugs = new Set(agents.map((a) => a.slug));
    const hasKids = (slug: string) => agents.some((x) => x.parent === slug);

    for (const a of agents) {
      const isOrch = !!a.is_master || a.type === "orchestrator";
      nodes.push({
        id: a.slug,
        label: a.slug,
        slug: a.slug,
        kind: isOrch ? "agent" : "agentlink",
        role: isOrch || hasKids(a.slug) ? "hub" : "leaf",
        emoji: a.emoji || undefined,
        relation: a.role || (isOrch ? t("project.agents.orchestrator") : t("project.overview.specialists")),
        detail: a.description || undefined,
      });
    }
    for (const a of agents) {
      const parent = a.parent && slugs.has(a.parent) ? a.parent : ROOT;
      edges.push({ source: parent, target: a.slug });
    }
    return { nodes, edges };
  }, [agents]);

  return (
    <BrainGraph
      nodes={nodes}
      edges={edges}
      height={520}
      onNodeClick={(n) => { if (n.slug) navigate(`/p/${pid}/agents/${n.slug}`); }}
    />
  );
}

function RosterRow({
  label, icon: Icon, agents, pid, navigate,
}: {
  label: string; icon: typeof Bot; agents: AgentEntry[]; pid: string; navigate: (to: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />{label} ({agents.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => (
          <button
            key={a.slug}
            type="button"
            onClick={() => navigate(`/p/${pid}/agents/${a.slug}`)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs hover:border-muted-fg/50",
            )}
          >
            <span className="text-sm leading-none">{a.emoji || "🤖"}</span>
            <span className="truncate">{a.slug}</span>
            {a.role && <span className="truncate text-[10px] text-muted-fg">· {a.role}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Card({ title, value, href, icon: Icon }: {
  title: string; value: number | string; href: string; icon: typeof Bot;
}) {
  return (
    <NavLink to={href} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:bg-accent/40">
      <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-fg">
        <Icon size={20} />
      </span>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-fg">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </NavLink>
  );
}
