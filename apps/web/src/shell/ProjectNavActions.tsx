import { Icons, type MenuEntry } from "@apx/ui";
import { markAllRead } from "../data/actions.ts";
import type { ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { updateProject } from "../data/projects.ts";
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

/** Turns a subproject into a project of its own: it stops working with its parent's agents and resources. */
async function detachProject(project: ProjectEntry, t: T): Promise<void> {
  if (await updateProject({ project: project.id, parent: null }))
    notify(t("project.detached", { name: project.name }), "info");
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
  /** "New subproject" (a project that is not one itself). */
  onNewSub?: () => void,
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
    ...(onNewSub && !project.parent
      ? [
          {
            label: t("project.newSub"),
            icon: <Icons.FolderPlus />,
            onSelect: () => {
              onClose();
              onNewSub();
            },
          },
        ]
      : []),
    ...(project.parent
      ? [
          {
            label: t("project.detach"),
            icon: <Icons.FolderOutput />,
            onSelect: () => {
              onClose();
              void detachProject(project, t);
            },
          },
        ]
      : []),
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
