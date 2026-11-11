// The four numbers on top of a project's overview: its chats, what waits for the owner, its routines and resources.
import type { Thread } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { DEFAULT_PID, isWorking, type ProjectEntry } from "../data/identity.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { loadTasks, tasksLoaded, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { type Waiting, waitingOf } from "./overviewData.ts";

export function useWaiting(pid: string, chats: Thread[]): Waiting {
  const tasks = useTasks((s) => s.tasks);
  useEffect(() => {
    if (!tasksLoaded()) void loadTasks();
  }, []);
  return useMemo(() => waitingOf(Object.values(tasks), chats, pid, pid === DEFAULT_PID), [tasks, chats, pid]);
}

/** Skills and MCP servers this project's agents can use: its own and the ones every project takes. */
function useResourceCounts(project: ProjectEntry): { skills: number; servers: number } | undefined {
  const [counts, setCounts] = useState<{ skills: number; servers: number }>();
  // The base project's resources are the global ones.
  const projectId = project.isDefault ? undefined : project.id;
  useEffect(() => {
    let live = true;
    setCounts(undefined);
    const scope = projectId ? { project: projectId } : {};
    Promise.all([client.call("skills.list", scope), client.call("mcp.list", scope)])
      .then(([s, m]) => {
        if (live) setCounts({ skills: s.skills.length, servers: m.servers.length });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);
  return counts;
}

export function OverviewStats({
  project,
  chats,
  waiting,
}: {
  project: ProjectEntry;
  chats: Thread[];
  waiting: Waiting;
}) {
  const t = useT();
  const routines = useRoutines((s) => s.routines);
  const routinesReady = useRoutines((s) => s.ready);
  useEffect(() => {
    if (!routinesReady) void loadRoutines();
  }, [routinesReady]);
  const mine = useMemo(() => {
    const here = (p: string | undefined) => (project.isDefault ? !p : p === project.id);
    return routines.filter((r) => r.action !== "relay" && here(r.project_id));
  }, [routines, project.id, project.isDefault]);
  const resources = useResourceCounts(project);
  const unread = chats.filter((th) => th.unread > 0).length;
  const runningRoutines = mine.filter((r) => isWorking(r.last?.state)).length;

  return (
    <div className="overview__stats">
      <Stat
        icon={<Icons.MessageCircle size={14} />}
        label={t("overview.chats")}
        value={chats.length}
        note={t("overview.unreadCount", { n: unread })}
        onClick={() => go.projectTab("chats")}
      />
      <Stat
        icon={<Icons.ListChecks size={14} />}
        label={t("overview.waiting")}
        value={waiting.tasks.length + waiting.chats.length}
        note={waiting.open === 1 ? t("overview.openTask") : t("overview.openTasks", { n: waiting.open })}
        onClick={() => go.projectTab("tasks")}
      />
      <Stat
        icon={<Icons.RefreshCw size={14} />}
        label={t("project.tab.routines")}
        value={routinesReady ? mine.length : undefined}
        note={t("overview.runningNow", { n: runningRoutines })}
        onClick={() => go.projectTab("routines")}
      />
      <Stat
        icon={<Icons.Layers size={14} />}
        label={t("project.tab.resources")}
        value={resources && resources.skills + resources.servers}
        note={resources ? t("overview.resourcesNote", { skills: resources.skills, mcp: resources.servers }) : ""}
        onClick={() => go.projectTab("resources")}
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  note,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  note: string;
  onClick: () => void;
}) {
  return (
    // ui: a stat tile (label, big number, a note under it) that opens its tab, as the owner's sketch draws it.
    <button type="button" className="overview__stat" onClick={onClick}>
      <span className="overview__statl">
        {icon}
        {label}
      </span>
      <span className="overview__statv">{value ?? "–"}</span>
      <span className="overview__statn">{note}</span>
    </button>
  );
}
