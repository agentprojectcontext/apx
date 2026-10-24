import type { Agent } from "@apx/protocol";
import { Icons, type SelectOption } from "@apx/ui";
import { type ReactElement, Suspense, useMemo } from "react";
import { useAgentOptions } from "../common/pickers/agentOptions.tsx";
import { inProject, isListed, realProjectId } from "../data/identity.ts";
import { newChatId } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SearchSelect } from "../lazy.ts";
import { go } from "../shell/nav.ts";

/** Agents the owner talked to lately, shown first. */
const RECENT = 5;

/** Who can start a chat in a project: the super-agent first, then the project's own agents. */
export function useChatAgents(projectId: string | undefined): Agent[] {
  const agents = useData((s) => s.agents);
  return useMemo(() => {
    const list = Object.values(agents);
    const sec = list.filter((a) => a.kind === "secretary");
    const own = list
      .filter((a) => a.kind !== "secretary" && (projectId ? inProject(a, projectId) : !a.project_id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...sec, ...own];
  }, [agents, projectId]);
}

/** Open a new chat with `agent` in a nav project (undefined / the base space = no project): made when first sent. */
export function startChat(agent: Agent, projectId: string | undefined, code = false): void {
  const project = realProjectId(projectId);
  const id = newChatId({ agent: agent.id, ...(project ? { project } : {}), code });
  if (projectId) go.project(projectId, "chats", id);
  else go.thread(id);
}

/**
 * "New chat with <agent>" picker around any trigger, with a search box: the agents used lately first, then all of
 * them by project. From the Inbox every project's agents are there (the chat goes to the agent's project); in a
 * project, its own and the super-agent, plus code sessions when the project has its folder on disk.
 */
export function NewChatMenu({ projectId, trigger }: { projectId: string | undefined; trigger: ReactElement }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const projects = useData((s) => s.projects);
  const pid = realProjectId(projectId);
  const all = useAgentOptions(projectId, !projectId, projectId ? "secretary" : "all");
  // A code session needs the project's folder on disk.
  const onDisk = projects.some((p) => p.id === pid && p.path && p.present);

  const options = useMemo<SelectOption[]>(() => {
    const offered = new Set(all.map((o) => o.value));
    const recent: string[] = [];
    for (const th of Object.values(threads)
      .filter((th) => isListed(th) && !th.engine && (!projectId || inProject(th, projectId)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      const id = th.agent_ids[0];
      if (id && offered.has(id) && !recent.includes(id)) recent.push(id);
      if (recent.length === RECENT) break;
    }
    const byId = new Map(all.map((o) => [o.value, o]));
    return [
      ...recent.flatMap((id) => {
        const o = byId.get(id);
        return o ? [{ ...o, value: `recent:${id}`, group: t("chat.recentAgents") }] : [];
      }),
      ...all,
      ...(onDisk
        ? all.map((o) => ({
            value: `code:${o.value}`,
            label: o.label,
            icon: <Icons.Code size={16} />,
            group: t("chat.newCodeWith"),
          }))
        : []),
    ];
  }, [all, threads, projectId, onDisk, t]);

  const pick = (value: string | null) => {
    if (!value) return;
    const [kind, id] = value.includes(":") ? value.split(":") : ["", value];
    const agent = agents[id ?? ""];
    if (!agent) return;
    if (projectId) return startChat(agent, projectId, kind === "code");
    // From the Inbox: the chat belongs to the agent's project, and opens here.
    go.thread(newChatId({ agent: agent.id, ...(agent.project_id ? { project: agent.project_id } : {}) }));
  };

  // The combobox loads after the first paint; until then the button shows, without its list.
  return (
    <Suspense fallback={trigger}>
      <SearchSelect
        trigger={trigger}
        label={t("chat.newWith")}
        searchPlaceholder={t("pickers.searchAgent")}
        emptyLabel={t("pickers.noMatch")}
        value={null}
        options={options}
        onValueChange={pick}
      />
    </Suspense>
  );
}
