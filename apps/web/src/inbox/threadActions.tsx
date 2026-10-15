// What can be done to a chat from its right-click menu (any Inbox view) or the chat header's "…" menu.
import type { Agent, Thread } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { markRead } from "../data/actions.ts";
import { openThreadDialog, updateThread } from "../data/threadAdmin.ts";
import type { T } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

/** Why a chat cannot be archived or deleted (Home, a task's chat), or undefined when it can. */
function lockedBy(thread: Thread, t: T): string | undefined {
  if (thread.kind === "home") return t("thread.menu.homeLocked");
  if (thread.kind === "task") return t("thread.menu.taskLocked");
  return undefined;
}

/** Pin, rename, archive, mark read, view its agent, then `extra` (header-only actions) and delete last. */
export function threadMenu(thread: Thread, o: { t: T; agent: Agent | undefined; extra?: MenuEntry[] }): MenuEntry[] {
  const { t, agent } = o;
  const locked = lockedBy(thread, t);
  return [
    thread.pinned
      ? {
          label: t("thread.menu.unpin"),
          icon: <Icons.PinOff />,
          onSelect: () => void updateThread(thread.id, { pinned: false }),
        }
      : {
          label: t("thread.menu.pin"),
          icon: <Icons.Pin />,
          onSelect: () => void updateThread(thread.id, { pinned: true }),
        },
    { label: t("thread.menu.rename"), icon: <Icons.Pencil />, onSelect: () => openThreadDialog("rename", thread.id) },
    thread.archived
      ? {
          label: t("thread.menu.unarchive"),
          icon: <Icons.ArchiveRestore />,
          onSelect: () => void updateThread(thread.id, { archived: false }),
        }
      : {
          label: t("thread.menu.archive"),
          icon: <Icons.Archive />,
          disabled: !!locked,
          onSelect: () => void updateThread(thread.id, { archived: true }),
        },
    {
      label: t("thread.menu.markRead"),
      icon: <Icons.CheckCheck />,
      disabled: thread.unread === 0,
      onSelect: () => void markRead(thread.id),
    },
    ...(agent && !thread.engine
      ? [{ label: t("thread.menu.viewAgent"), icon: <Icons.Bot />, onSelect: () => go.agent(agent.id) }]
      : []),
    ...(thread.kind === "a2a" && thread.parent_id
      ? [
          {
            label: t("thread.menu.openParent"),
            icon: <Icons.Reply />,
            onSelect: () => go.thread(thread.parent_id as string),
          },
        ]
      : []),
    ...(o.extra ?? []),
    { type: "separator" },
    {
      label: t("thread.menu.delete"),
      icon: <Icons.Trash2 />,
      danger: true,
      disabled: !!locked,
      onSelect: () => openThreadDialog("delete", thread.id),
    },
    ...(locked ? [{ type: "label" as const, label: locked }] : []),
  ];
}
