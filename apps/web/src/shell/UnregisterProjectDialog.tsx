import "../styles/screens.css";
import { Button, Dialog } from "@apx/ui";
import { useState } from "react";
import type { ProjectEntry } from "../data/identity.ts";
import { unregisterProject } from "../data/projects.ts";
import { useT } from "../i18n/index.ts";
import { go, nav } from "./nav.ts";

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
