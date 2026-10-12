import { Icons, type MenuEntry } from "@apx/ui";
import { markAllRead } from "../data/actions.ts";
import type { ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import type { T } from "../i18n/index.ts";
import { go } from "./nav.ts";

async function copyPath(path: string, t: T): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    notify(t("files.copied"), "info");
  } catch {
    notify(t("files.copyFailed"));
  }
}

/** The same project actions from either the row's overflow or its context menu. */
export function projectNavMenu(
  project: ProjectEntry,
  t: T,
  onSettings: () => void,
  onRemove: () => void,
  onClose: () => void,
  /** Its unread chats, for "Mark all as read". */
  unread: readonly string[] = [],
): MenuEntry[] {
  return [
    {
      label: t("nav.open"),
      icon: <Icons.FolderOpen />,
      onSelect: () => {
        onClose();
        go.project(project.id);
      },
    },
    {
      label: t("project.settings"),
      icon: <Icons.Settings />,
      onSelect: () => {
        onClose();
        onSettings();
      },
    },
    {
      label: t("inbox.markAllRead"),
      icon: <Icons.CheckCheck />,
      disabled: unread.length === 0,
      onSelect: () => {
        onClose();
        void markAllRead(unread);
      },
    },
    {
      label: t("files.copyPath"),
      icon: <Icons.Copy />,
      disabled: !project.path,
      onSelect: () => {
        onClose();
        if (project.path) void copyPath(project.path, t);
      },
    },
    ...(!project.isDefault
      ? [
          { type: "separator" as const },
          {
            label: t("project.unregister"),
            icon: <Icons.Trash2 />,
            danger: true,
            onSelect: () => {
              onClose();
              onRemove();
            },
          },
        ]
      : []),
  ];
}
