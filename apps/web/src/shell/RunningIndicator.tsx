import { AgentAvatar, Icons, Menu, type MenuEntry, Spinner } from "@apx/ui";
import { useMemo } from "react";
import { blobOf, isWorking, projectName, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { go } from "./nav.ts";

/** Topbar pill: how many threads are working or waiting for you; the menu jumps to them. */
export function RunningIndicator() {
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const active = useMemo(
    () =>
      Object.values(threads)
        .filter((t) => isWorking(t.state) || t.state === "input-required")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads],
  );
  const working = active.filter((t) => isWorking(t.state)).length;
  const waiting = active.length - working;

  const items: MenuEntry[] = active.length
    ? [
        { type: "label", label: "En curso" },
        ...active.map((t): MenuEntry => {
          const agent = threadAgent(t, agents);
          return {
            label: (
              <span className="running__item">
                <span className="running__title">{t.title}</span>
                <span className="running__sub">
                  {projectName(projects, t.project_id)} · {agent?.name ?? "Agente"}
                  {t.state === "input-required" ? " · te espera" : ""}
                </span>
              </span>
            ),
            icon: agent ? <AgentAvatar name={agent.name} blob={blobOf(agent)} size={20} animated={false} /> : undefined,
            onSelect: () => go.thread(t.id),
          };
        }),
      ]
    : [{ type: "label", label: "Nada corriendo ahora." }];

  return (
    <Menu
      align="end"
      items={items}
      trigger={
        <button
          type="button"
          className={active.length ? "running is-active" : "running"}
          aria-label={`${working} en curso, ${waiting} esperando`}
        >
          {working > 0 ? <Spinner size={12} /> : <Icons.Bot size={14} />}
          <span>{working}</span>
          {working > 0 && <Icons.Bot size={14} />}
          {waiting > 0 && (
            <>
              <span className="running__div" />
              <Icons.Hand size={14} />
              <span>{waiting}</span>
            </>
          )}
          <Icons.ChevronDown size={14} />
        </button>
      }
    />
  );
}
