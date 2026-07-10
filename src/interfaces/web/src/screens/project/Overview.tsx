import { useMemo, useState } from "react";
import useSWR from "swr";
import { NavLink, useNavigate } from "react-router-dom";
import { Bot, Briefcase, Brain, FileCode2, Heart, MessagesSquare, Puzzle, Zap, Crown, Activity } from "lucide-react";
import { Agents, Artifacts, Conversations, Mcps, Routines, Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { StatusIcon, StatusBadge, effectiveStatus, statusLabel, TASK_STATUS_ORDER } from "../../components/tasks/taskStatus";
import { BrainGraph, type BrainNode, type BrainEdge } from "./AgentBrainGraph";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { AgentEntry, RoutineEntry, TaskEntry } from "../../types/daemon";

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

      {/* Team brain — full-width at the bottom. Collapsed: the agent map.
          Expanded: every agent's full sub-brain (memory / threads / tasks /
          heartbeats), all connected by hierarchy. */}
      {agentList.length > 0 && (
        <Section title={t("project.overview.brain_title")} description={t("project.overview.brain_desc")} className="!p-4">
          <TeamBrain pid={pid} agents={agentList} routines={routines.data ?? []} navigate={navigate} />
        </Section>
      )}
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

// One memory-fact-per-line, trimmed of markdown noise (mirrors the per-agent brain).
function memoryFacts(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*#>\s]+/, "").trim())
    .filter((l) => l.length > 2 && !l.startsWith("```"))
    .slice(0, 5);
}

interface TeamDetail {
  tasks: TaskEntry[];
  perAgent: Record<string, { memory: string; threads: { title: string; id: string }[] }>;
}

// Whole-project agent map. Collapsed, the core is the team and every agent hangs
// off its parent (orchestrators → specialists) as satellite clusters. Expanded,
// each agent becomes a hub with its own sub-brain — memory / threads / tasks /
// heartbeats — so the whole company reads as one connected brain-of-brains.
function TeamBrain({
  pid, agents, routines, navigate,
}: {
  pid: string; agents: AgentEntry[]; routines: RoutineEntry[]; navigate: (to: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Only fetch the heavy per-agent data when the user asks to expand.
  const detail = useSWR<TeamDetail | null>(
    expanded ? `/team-brain/${pid}/${agents.map((a) => a.slug).join(",")}` : null,
    async () => {
      const tasks = await Tasks.list(pid, "all");
      const entries = await Promise.all(
        agents.map(async (a) => {
          const [d, threads] = await Promise.all([
            Agents.get(pid, a.slug).catch(() => null),
            Conversations.list(pid, a.slug).catch(() => []),
          ]);
          return [a.slug, {
            memory: d?.memory || "",
            threads: (threads || []).slice(0, 4).map((th) => ({ title: th.title || th.filename, id: th.id })),
          }] as const;
        }),
      );
      return { tasks, perAgent: Object.fromEntries(entries) };
    },
  );

  const showFull = expanded && !!detail.data;

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
        // In full mode every agent is a hub (it carries its own sub-brain).
        role: showFull || isOrch || hasKids(a.slug) ? "hub" : "leaf",
        emoji: a.emoji || undefined,
        relation: a.role || (isOrch ? t("project.agents.orchestrator") : t("project.overview.specialists")),
        detail: a.description || undefined,
      });
    }
    for (const a of agents) {
      const parent = a.parent && slugs.has(a.parent) ? a.parent : ROOT;
      edges.push({ source: parent, target: a.slug });
    }

    // Expanded: graft each agent's own items as leaves off the agent node.
    if (showFull && detail.data) {
      const { tasks, perAgent } = detail.data;
      const push = (id: string, label: string, kind: BrainNode["kind"], parent: string, detailText?: string) => {
        nodes.push({ id, label, kind, detail: detailText });
        edges.push({ source: parent, target: id });
      };
      for (const a of agents) {
        const info = perAgent[a.slug];
        memoryFacts(info?.memory || "").forEach((f, i) => push(`${a.slug}:m${i}`, f, "memory", a.slug, f));
        (info?.threads || []).forEach((th, i) => push(`${a.slug}:th${i}`, th.title, "thread", a.slug));
        tasks.filter((tk) => tk.agent === a.slug).slice(0, 4)
          .forEach((tk, i) => push(`${a.slug}:ts${i}`, tk.title, "task", a.slug, tk.body || undefined));
        routines.filter((r) => (r.spec as { agent?: string })?.agent === a.slug).slice(0, 2)
          .forEach((r, i) => push(`${a.slug}:rt${i}`, r.name, "routine", a.slug, `schedule: ${r.schedule}`));
      }
    }
    return { nodes, edges };
  }, [agents, routines, showFull, detail.data]);

  const toggle = (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium backdrop-blur transition-colors",
        expanded ? "border-primary/40 bg-primary/15 text-foreground" : "border-border bg-card/80 text-muted-fg hover:text-foreground",
      )}
    >
      <Brain className={cn("size-3.5", detail.isLoading && "animate-pulse")} />
      {expanded ? t("agents_ui.brain_collapse") : t("agents_ui.brain_expand")}
    </button>
  );

  return (
    <BrainGraph
      nodes={nodes}
      edges={edges}
      height={620}
      toolbar={toggle}
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
