import type { Agent } from "@apx/protocol";
import { AgentAvatar, Menu, type MenuEntry } from "@apx/ui";
import { type ReactElement, useMemo, useState } from "react";
import { createThread } from "../data/actions.ts";
import { blobOf, inProject, realProjectId } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { t as tr, useT } from "../i18n/index.ts";
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

/** Create a chat with `agent` in a nav project (undefined / the base space = no project) and open it. */
export async function startChat(agent: Agent, projectId: string | undefined): Promise<void> {
  try {
    const t = await createThread({ agentId: agent.id, projectId: realProjectId(projectId), title: tr("chat.new") });
    if (projectId) go.project(projectId, "chats", t.id);
    else go.thread(t.id);
  } catch (e) {
    notify(tr("error.createChat", { error: e instanceof Error ? e.message : String(e) }));
  }
}

/** "New chat with <agent>" picker around any trigger. */
export function NewChatMenu({ projectId, trigger }: { projectId: string | undefined; trigger: ReactElement }) {
  const t = useT();
  const list = useChatAgents(projectId);
  const [busy, setBusy] = useState(false);
  const items: MenuEntry[] = list.length
    ? [
        { type: "label", label: t("chat.newWith") },
        ...list.slice(0, 20).map(
          (a): MenuEntry => ({
            label: a.name,
            icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={18} animated={false} />,
            shortcut: a.kind === "secretary" ? t("agent.super") : undefined,
            disabled: busy,
            onSelect: async () => {
              setBusy(true);
              await startChat(a, projectId);
              setBusy(false);
            },
          }),
        ),
      ]
    : [{ type: "label", label: t("chat.noAgents") }];
  return <Menu align="end" items={items} trigger={trigger} />;
}
