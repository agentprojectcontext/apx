import type { Agent } from "@apx/protocol";
import { AgentAvatar, Icons, Menu, type MenuEntry } from "@apx/ui";
import { type ReactElement, useMemo } from "react";
import { blobOf, inProject, realProjectId } from "../data/identity.ts";
import { newChatId } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

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

/** "New chat with <agent>" picker around any trigger. */
export function NewChatMenu({ projectId, trigger }: { projectId: string | undefined; trigger: ReactElement }) {
  const t = useT();
  const list = useChatAgents(projectId);
  const projects = useData((s) => s.projects);
  const pid = realProjectId(projectId);
  // A code session needs the project's folder on disk.
  const onDisk = projects.some((p) => p.id === pid && p.path && p.present);
  const items: MenuEntry[] = list.length
    ? [
        { type: "label", label: t("chat.newWith") },
        ...list.slice(0, 20).map(
          (a): MenuEntry => ({
            label: a.name,
            icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={18} animated={false} />,
            shortcut: a.kind === "secretary" ? t("agent.super") : undefined,
            onSelect: () => startChat(a, projectId),
          }),
        ),
        ...(onDisk
          ? [
              { type: "label", label: t("chat.newCodeWith") } as MenuEntry,
              ...list.slice(0, 8).map(
                (a): MenuEntry => ({
                  label: a.name,
                  icon: <Icons.Code size={16} />,
                  onSelect: () => startChat(a, projectId, true),
                }),
              ),
            ]
          : []),
      ]
    : [{ type: "label", label: t("chat.noAgents") }];
  return <Menu align="end" items={items} trigger={trigger} />;
}
