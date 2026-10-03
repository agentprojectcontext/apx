import { Button, Dialog, Field, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { bootstrap } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { addProject } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

/** A folder becomes a project: typed, or picked with the desktop app's folder dialog. Opens it once added. */
export function NewProjectDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const dir = await window.apxDesktop?.pickFolder?.();
    if (dir) setPath(dir);
  };
  const add = async () => {
    if (!path.trim() || busy) return;
    setBusy(true);
    const project = await addProject(path.trim());
    setBusy(false);
    if (!project) return;
    notify(t("setup.project.added", { name: project.name }), "info");
    await bootstrap().catch(() => {});
    onClose();
    go.project(project.id);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("project.new.title")}
      description={t("project.new.body")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!path.trim()} loading={busy} onClick={() => void add()}>
            {t("project.new.add")}
          </Button>
        </>
      }
    >
      <Field label={t("project.new.path")}>
        {(id) => (
          <div className="newproject__row">
            <Input
              id={id}
              autoFocus
              className="is-mono"
              placeholder={t("setup.project.pathPlaceholder")}
              value={path}
              onChange={(e) => setPath(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            {window.apxDesktop?.pickFolder && (
              <Button variant="secondary" leadingIcon={<Icons.FolderOpen size={14} />} onClick={() => void pick()}>
                {t("setup.project.pick")}
              </Button>
            )}
          </div>
        )}
      </Field>
    </Dialog>
  );
}
