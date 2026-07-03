import useSWR from "swr";
import { NavLink } from "react-router-dom";
import { Bot, FileCode2, Heart, MessagesSquare, Puzzle, Zap } from "lucide-react";
import { Agents, Artifacts, Mcps, Routines, Tasks } from "../../lib/api";
import { t } from "../../i18n";

export function Overview({ pid }: { pid: string }) {
  const tasks    = useSWR(`/projects/${pid}/tasks?state=open`, () => Tasks.list(pid));
  const routines = useSWR(`/projects/${pid}/routines`,         () => Routines.list(pid));
  const agents   = useSWR(`/projects/${pid}/agents`,           () => Agents.list(pid));
  const mcps     = useSWR(`/projects/${pid}/mcps`,             () => Mcps.list(pid));
  const artifacts = useSWR(`/projects/${pid}/artifacts`,       () => Artifacts.list(pid));
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <Card title={t("project.overview.tasks_open")} value={tasks.data?.length ?? "…"}    href={`/p/${pid}/tasks`}    icon={Zap} />
      <Card title={t("project.overview.routines")}   value={routines.data?.length ?? "…"} href={`/p/${pid}/routines`} icon={Heart} />
      <Card title={t("project.overview.agents")}     value={agents.data?.length ?? "…"}   href={`/p/${pid}/agents`}   icon={Bot} />
      <Card title={t("project.overview.mcps")}       value={mcps.data?.length ?? "…"}     href={`/p/${pid}/mcps`}     icon={Puzzle} />
      <Card title={t("project.overview.artifacts")}  value={artifacts.data?.length ?? "…"} href={`/p/${pid}/artifacts`} icon={FileCode2} />
      <Card title={t("project.overview.chat")}       value={t("project.overview.chat_value")} href={`/p/${pid}/chat`}  icon={MessagesSquare} />
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
