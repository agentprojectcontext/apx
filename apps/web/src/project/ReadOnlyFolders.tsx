import type { Project } from "@apx/protocol";
import { Button, Field, IconButton, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { updateProject } from "../data/projects.ts";
import { useT } from "../i18n/index.ts";

/** Folders a project's agents may read and never change. Each add or remove is saved at once: the core checks the path. */
export function ReadOnlyFolders({ project }: { project: Project }) {
  const t = useT();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const folders = project.read_only_folders ?? [];
  const save = async (next: string[]) => {
    setBusy(true);
    const done = await updateProject({ project: project.id, read_only_folders: next });
    setBusy(false);
    return Boolean(done);
  };
  const add = async () => {
    const p = path.trim();
    if (!p || busy) return;
    if (await save([...folders, p])) setPath("");
  };
  const pick = async () => {
    const dir = await window.apxDesktop?.pickFolder?.();
    if (dir) setPath(dir);
  };
  return (
    <Field label={t("project.settings.readOnly")} hint={t("project.settings.readOnlyHint")}>
      {(id) => (
        <div className="projsettings__folders">
          {folders.length ? (
            <ul className="projsettings__list" aria-label={t("project.settings.readOnly")}>
              {folders.map((f) => (
                <li key={f}>
                  <code className="projsettings__path">{f}</code>
                  <IconButton
                    size="sm"
                    label={t("project.settings.readOnlyRemove", { path: f })}
                    icon={<Icons.X />}
                    disabled={busy}
                    onClick={() => void save(folders.filter((x) => x !== f))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="projsettings__none">{t("project.settings.readOnlyNone")}</p>
          )}
          <div className="newproject__row">
            <Input
              id={id}
              className="is-mono"
              placeholder={t("project.settings.readOnlyPlaceholder")}
              value={path}
              onChange={(e) => setPath(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            {window.apxDesktop?.pickFolder && (
              <Button variant="secondary" leadingIcon={<Icons.FolderOpen size={14} />} onClick={() => void pick()}>
                {t("setup.project.pick")}
              </Button>
            )}
            <Button variant="secondary" disabled={!path.trim()} loading={busy} onClick={() => void add()}>
              {t("project.settings.readOnlyAdd")}
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}
