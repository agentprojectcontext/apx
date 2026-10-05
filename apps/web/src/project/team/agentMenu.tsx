// What can be done to an agent from its right-click menu (org chart card, list row) or its "…" button.
import type { Agent } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import type { T } from "../../i18n/index.ts";

export type AgentActions = {
  onOpen(a: Agent): void;
  onEdit(a: Agent): void;
  onChat(a: Agent): void;
  onDelete(a: Agent): void;
};

/** See its details, edit it, chat with it, and delete it last; the super-agent cannot be deleted. */
export function agentMenu(agent: Agent, t: T, o: AgentActions): MenuEntry[] {
  const locked = agent.kind === "secretary";
  return [
    { label: t("team.menu.open"), icon: <Icons.Eye />, onSelect: () => o.onOpen(agent) },
    { label: t("team.menu.edit"), icon: <Icons.Pencil />, onSelect: () => o.onEdit(agent) },
    { label: t("team.chat"), icon: <Icons.MessageCircle />, onSelect: () => o.onChat(agent) },
    { type: "separator" },
    {
      label: t("team.menu.delete"),
      icon: <Icons.Trash2 />,
      danger: true,
      disabled: locked,
      onSelect: () => o.onDelete(agent),
    },
    ...(locked ? [{ type: "label" as const, label: t("team.menu.superLocked") }] : []),
  ];
}
