import useSWR from "swr";
import { NavLink, useNavigate } from "react-router-dom";
import { Bot, FileCode2, Heart, MessagesSquare, Puzzle, Zap, Crown, Activity } from "lucide-react";
import { Agents, Artifacts, Mcps, Routines, Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { StatusIcon, StatusBadge, effectiveStatus, statusLabel, TASK_STATUS_ORDER } from "../../components/tasks/taskStatus";
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
