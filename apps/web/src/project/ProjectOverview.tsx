import type { Agent } from "@apx/protocol";
import { AgentAvatar, EmptyState, Icons, ProjectTile, Spinner } from "@apx/ui";
import { useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, inProject, isWorking, type ProjectEntry, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { go } from "../shell/nav.ts";

/** Resumen: what runs now, the team, counts and the latest chats. All real data; nothing sampled. */
export function ProjectOverview({ project }: { project: ProjectEntry }) {
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const surfaces = useData((s) => s.surfaces);
  const pid = project.id;

  const chats = useMemo(
    () =>
      Object.values(threads)
        .filter((t) => !t.parent_id && t.kind !== "a2a" && inProject(t, pid))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads, pid],
  );
  const running = chats.filter((t) => isWorking(t.state) || t.state === "input-required");
  const team = useMemo(() => teamOf(agents, pid), [agents, pid]);
  const unread = chats.reduce((n, t) => n + t.unread, 0);
  const apps = useMemo(
    () => Object.values(surfaces).filter((s) => (s.app || s.pinned) && inProject(s, pid)),
    [surfaces, pid],
  );

  return (
    <div className="overview">
      <div className="overview__col">
        <section className="overview__block">
          <h2 className="overview__h">Ahora</h2>
          {running.length ? (
            running.map((t) => {
              const agent = threadAgent(t, agents);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="overview__run"
                  onClick={() => go.project(pid, "chats", t.id)}
                >
                  <AgentAvatar name={agent?.name ?? t.title} blob={blobOf(agent)} size={32} animated={false} />
                  <span className="overview__runtext">
                    <span className="overview__runtitle">{t.title}</span>
                    <span className="overview__runsub">
                      {agent?.name ?? "Agente"} · {t.state === "input-required" ? "te espera" : firstLine(t.preview)}
                    </span>
                  </span>
                  {isWorking(t.state) ? <Spinner size={14} /> : <Icons.Hand size={14} />}
                </button>
              );
            })
          ) : (
            <EmptyState variant="dashed">Nada corriendo en este proyecto.</EmptyState>
          )}
        </section>

        <section className="overview__block">
          <h2 className="overview__h">
            Equipo <span className="overview__hsub">{team.length} agentes</span>
          </h2>
          {team.length ? (
            <div className="overview__pills">
              {team.map((a) => (
                <button key={a.id} type="button" className="overview__pill" onClick={() => go.projectTab("team")}>
                  <AgentAvatar name={a.name} blob={blobOf(a)} size={24} animated={false} />
                  <span className="overview__pillname">{a.name}</span>
                  {a.role && <span className="overview__pillrole">{a.role}</span>}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState variant="dashed">Este proyecto todavía no tiene agentes propios.</EmptyState>
          )}
        </section>
      </div>

      <div className="overview__col">
        <div className="overview__stats">
          <Stat value={chats.length} label="Chats" onClick={() => go.projectTab("chats")} />
          <Stat value={unread} label="Sin leer" onClick={() => go.projectTab("chats")} />
          <Stat value={team.length} label="Agentes" onClick={() => go.projectTab("team")} />
        </div>

        {apps.length > 0 && (
          <section className="overview__block">
            <h2 className="overview__h">Apps y widgets</h2>
            {apps.map((s) => (
              <button
                key={s.id}
                type="button"
                className="overview__row"
                onClick={() => (s.app ? go.app(s.id) : undefined)}
                disabled={!s.app}
              >
                <ProjectTile tone="violet" icon={<Icons.LayoutGrid />} size={20} />
                <span className="overview__rowname">{s.title}</span>
                <span className="overview__rowwhen">{s.app ? "App" : "Fijado"}</span>
              </button>
            ))}
          </section>
        )}

        <section className="overview__block">
          <h2 className="overview__h">
            Chats recientes
            {chats.length > 0 && (
              <button type="button" className="overview__link" onClick={() => go.projectTab("chats")}>
                Ver todos
              </button>
            )}
          </h2>
          {chats.length ? (
            chats.slice(0, 5).map((t) => (
              <button key={t.id} type="button" className="overview__row" onClick={() => go.project(pid, "chats", t.id)}>
                <Icons.MessageCircle size={14} />
                <span className="overview__rowname">{t.title}</span>
                {t.unread > 0 && <span className="overview__unread">{t.unread}</span>}
                <span className="overview__rowwhen">{shortWhen(t.updated_at)}</span>
              </button>
            ))
          ) : (
            <EmptyState variant="dashed">Todavía no hay chats acá.</EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return (
    <button type="button" className="overview__stat" onClick={onClick}>
      <span className="overview__statv">{value}</span>
      <span className="overview__statl">{label}</span>
    </button>
  );
}

/** The project's agents; the base space shows the super-agent and agents without a project. */
export function teamOf(agents: Record<string, Agent>, pid: string): Agent[] {
  return Object.values(agents)
    .filter((a) => inProject(a, pid))
    .sort((a, b) => Number(b.kind === "secretary") - Number(a.kind === "secretary") || a.name.localeCompare(b.name));
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "Trabajando…").replace(/\*\*|`/g, "");
}
