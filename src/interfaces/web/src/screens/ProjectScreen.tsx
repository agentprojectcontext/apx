import useSWR from "swr";
import { NavLink, Route, Routes, useParams } from "react-router-dom";
import {
  Wrench,
  Bot,
  Heart,
  Zap,
  Puzzle,
  MessageSquare,
  FolderKanban,
  Settings,
} from "lucide-react";
import { Agents, Mcps, Projects, Routines, Tasks } from "../lib/api";
import { Section } from "../components/Section";
import { projectKindLabel } from "../components/ProjectSidebar";
import { cn } from "../lib/cn";

/**
 * Per-project view. Inner left-column nav switches between the project's
 * surfaces: config, agents, skills (sourced from config), routines, tasks,
 * MCPs, threads (chat / sessions). All data comes from the daemon endpoints
 * we already expose; no new server work for this screen.
 */
export function ProjectScreen() {
  const { pid = "" } = useParams();
  const { data: list } = useSWR("/projects", () => Projects.list());
  const project = list?.find((p) => String(p.id) === pid);

  if (!project) {
    return (
      <div className="p-8 text-muted-fg">
        Proyecto <code>{pid}</code> no encontrado.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ProjectNav pid={pid} />
      <div className="flex-1 overflow-y-auto">
        <header className="border-b border-border bg-card/40 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {project.name || project.path.split("/").pop()}
              </h1>
              <p className="text-xs text-muted-fg">
                {projectKindLabel(project.kind)} · {project.path}
              </p>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <Routes>
            <Route index               element={<Overview pid={pid} />} />
            <Route path="config"       element={<ConfigTab pid={pid} />} />
            <Route path="agents"       element={<AgentsTab pid={pid} />} />
            <Route path="routines"     element={<RoutinesTab pid={pid} />} />
            <Route path="tasks"        element={<TasksTab pid={pid} />} />
            <Route path="mcps"         element={<McpsTab pid={pid} />} />
            <Route path="threads"      element={<ThreadsTab pid={pid} />} />
            <Route path="*"            element={<Overview pid={pid} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { to: "",         label: "Overview", icon: FolderKanban },
  { to: "config",   label: "Config",   icon: Settings },
  { to: "agents",   label: "Agents",   icon: Bot },
  { to: "routines", label: "Heartbeats / Routines", icon: Heart },
  { to: "tasks",    label: "Tasks",    icon: Zap },
  { to: "mcps",     label: "MCPs",     icon: Puzzle },
  { to: "threads",  label: "Threads",  icon: MessageSquare },
] as const;

function ProjectNav({ pid }: { pid: string }) {
  return (
    <nav className="hidden w-48 shrink-0 border-r border-border bg-card/30 py-4 md:block">
      <ul className="space-y-0.5 px-2">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to ? `/p/${pid}/${item.to}` : `/p/${pid}`}
              end={!item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                  isActive
                    ? "bg-accent text-accent-fg"
                    : "text-muted-fg hover:bg-accent/60 hover:text-accent-fg"
                )
              }
            >
              <item.icon size={15} />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Overview({ pid }: { pid: string }) {
  const tasks = useSWR(`/projects/${pid}/tasks?state=open`,    () => Tasks.list(pid));
  const routines = useSWR(`/projects/${pid}/routines`,         () => Routines.list(pid));
  const agents = useSWR(`/projects/${pid}/agents`,             () => Agents.list(pid));
  const mcps  = useSWR(`/projects/${pid}/mcps`,                () => Mcps.list(pid));
  return (
    <div className="grid grid-cols-2 gap-4">
      <SummaryCard title="Tasks abiertas" value={tasks.data?.length ?? "…"} href={`/p/${pid}/tasks`} icon={Zap} />
      <SummaryCard title="Rutinas"        value={routines.data?.length ?? "…"} href={`/p/${pid}/routines`} icon={Heart} />
      <SummaryCard title="Agents"         value={agents.data?.length ?? "…"} href={`/p/${pid}/agents`} icon={Bot} />
      <SummaryCard title="MCPs"           value={mcps.data?.length ?? "…"} href={`/p/${pid}/mcps`} icon={Puzzle} />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  href,
  icon: Icon,
}: {
  title: string;
  value: number | string;
  href: string;
  icon: typeof Wrench;
}) {
  return (
    <NavLink
      to={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:bg-accent/40"
    >
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

function ConfigTab({ pid }: { pid: string }) {
  const cfg = useSWR(`/projects/${pid}/config`, () => Projects.config.show(pid));
  return (
    <Section title="Project config" description="Override del super_agent.model, permission_mode, route_to_agent, etc.">
      <pre className="overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
        {cfg.data ? JSON.stringify(cfg.data, null, 2) : "Cargando…"}
      </pre>
    </Section>
  );
}

function AgentsTab({ pid }: { pid: string }) {
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  return (
    <Section title="Agents" description="Definidos en AGENTS.md + .apc/agents/<slug>/.">
      <ul className="space-y-2 text-sm">
        {(agents.data || []).map((a) => (
          <li key={a.slug} className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{a.slug}</span>
              <span className="text-xs text-muted-fg">{a.model || "(sin modelo)"}</span>
            </div>
            {a.description && <p className="mt-1 text-xs text-muted-fg">{a.description}</p>}
          </li>
        ))}
        {agents.data && agents.data.length === 0 && (
          <li className="text-sm text-muted-fg">Sin agents. Agregá uno con <code>apx agent add</code>.</li>
        )}
      </ul>
    </Section>
  );
}

function RoutinesTab({ pid }: { pid: string }) {
  const r = useSWR(`/projects/${pid}/routines`, () => Routines.list(pid));
  return (
    <Section title="Heartbeats / Routines" description="Tareas programadas: cron, every:Nm, once:ISO.">
      <ul className="space-y-2 text-sm">
        {(r.data || []).map((row) => (
          <li key={row.name} className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.name}</span>
              <span className={cn("text-xs", row.enabled ? "text-emerald-500" : "text-muted-fg")}>
                {row.enabled ? "enabled" : "disabled"} · {row.kind}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-fg">
              <span>schedule: <span className="font-mono">{row.schedule}</span></span>
              <span>next: <span className="font-mono">{row.next_run_at || "—"}</span></span>
            </div>
            {row.last_error && (
              <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {row.last_error}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TasksTab({ pid }: { pid: string }) {
  const tasks = useSWR(`/projects/${pid}/tasks?state=open`, () => Tasks.list(pid));
  return (
    <Section title="Tasks (TODOs)" description="Append-only JSONL en ~/.apx/projects/&lt;id&gt;/tasks/.">
      <ul className="space-y-2 text-sm">
        {(tasks.data || []).map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="font-mono text-xs text-muted-fg">{t.id}</span>
            <span className="flex-1">{t.title}</span>
            {t.due && <span className="text-xs text-muted-fg">{t.due}</span>}
          </li>
        ))}
        {tasks.data?.length === 0 && (
          <li className="text-sm text-muted-fg">Sin tasks. <code>apx task add "…"</code></li>
        )}
      </ul>
    </Section>
  );
}

function McpsTab({ pid }: { pid: string }) {
  const list = useSWR(`/projects/${pid}/mcps`, () => Mcps.list(pid));
  return (
    <Section title="MCP servers" description="3 scopes: runtime > shared > global.">
      <ul className="space-y-2 text-sm">
        {(list.data || []).map((m) => (
          <li key={m.name} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="font-medium">{m.name}</span>
            <span className="rounded-md bg-accent px-2 py-0.5 text-xs">{m.source}</span>
            <span className="ml-auto text-xs text-muted-fg">
              {m.transport} · {m.enabled === false ? "disabled" : "enabled"}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ThreadsTab({ pid }: { pid: string }) {
  return (
    <Section
      title="Threads"
      description="Conversaciones por agente. UI completa pendiente — abrí la TUI por ahora con apx code --agent <slug>."
    >
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-fg">
        Coming soon. Backend ya expone <code>/projects/{pid}/agents/&lt;slug&gt;/conversations</code>.
      </div>
    </Section>
  );
}
