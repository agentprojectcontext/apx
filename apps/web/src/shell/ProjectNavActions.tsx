import { Button, Dialog, Icons, type MenuEntry } from "@apx/ui";
import { useState } from "react";
import type { ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { unregisterProject } from "../data/projects.ts";
import { type T, useT } from "../i18n/index.ts";
import { go, nav } from "./nav.ts";

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

/** Registry removal asks first and keeps files, chats and tasks. */
export function UnregisterProjectDialog({ project, onClose }: { project: ProjectEntry; onClose(): void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await unregisterProject(project.id);
    setBusy(false);
    if (!ok) return;
    if (nav.get().view === "project" && nav.get().projectId === project.id) go.inbox();
    onClose();
  };
  return (
    <Dialog
      open
      title={t("project.unregisterTitle", { name: project.name })}
      description={t("project.unregisterBody")}
      onOpenChange={(open) => !open && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("project.unregister")}
          </Button>
        </>
      }
    >
      {project.path && <code className="projsettings__path">{project.path}</code>}
    </Dialog>
  );
}
