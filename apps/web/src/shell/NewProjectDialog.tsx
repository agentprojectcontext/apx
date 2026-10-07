import type { ProjectKind } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, SegmentedControl, Select, Textarea } from "@apx/ui";
import { type KeyboardEvent, useState } from "react";
import { bootstrap } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { createProject } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import { kindOptions, NO_KIND } from "../project/ProjectSettings.tsx";
import { go } from "./nav.ts";

type Where = "folder" | "apx";

/** The folder name the core gives a project without one (the same rule as its `slugOf`). */
const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
const baseName = (p: string) =>
  p
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .at(-1) ?? "";

/**
 * A new project: in a folder (typed or picked; made if missing) or, without one, in a folder of its own inside APX's.
 * Its name (the folder's when left empty), kind and description are the ones its settings show. Opens it once made.
 */
export function NewProjectDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const [where, setWhere] = useState<Where>("folder");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>(NO_KIND);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = where === "folder" ? Boolean(path.trim()) : Boolean(name.trim());
  const pick = async () => {
    const dir = await window.apxDesktop?.pickFolder?.();
    if (dir) setPath(dir);
  };
  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const project = await createProject({
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(kind !== NO_KIND ? { kind: kind as ProjectKind } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(where === "folder" ? { path: path.trim() } : {}),
    });
    setBusy(false);
    if (!project) return;
    notify(t("setup.project.added", { name: project.name }), "info");
    await bootstrap().catch(() => {});
    onClose();
    go.project(project.id);
  };
  const submitOnEnter = (e: KeyboardEvent) => e.key === "Enter" && void add();
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
          <Button disabled={!ready} loading={busy} onClick={() => void add()}>
            {t("project.new.add")}
          </Button>
        </>
      }
    >
      <div className="newproject">
        <SegmentedControl
          label={t("project.new.where")}
          value={where}
          onValueChange={(v) => setWhere(v as Where)}
          options={[
            { value: "folder", label: t("project.new.inFolder") },
            { value: "apx", label: t("project.new.noFolder") },
          ]}
        />
        {where === "folder" ? (
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
                  onKeyDown={submitOnEnter}
                />
                {window.apxDesktop?.pickFolder && (
                  <Button variant="secondary" leadingIcon={<Icons.FolderOpen size={14} />} onClick={() => void pick()}>
                    {t("setup.project.pick")}
                  </Button>
                )}
              </div>
            )}
          </Field>
        ) : (
          <p className="newproject__hint">
            {t("project.new.apxHint")} <code>~/.apx/v2/projects/{slugOf(name.trim() || t("project.new.example"))}</code>
          </p>
        )}
        <Field label={t("project.settings.name")}>
          {(id) => (
            <Input
              id={id}
              {...(where === "apx" ? { autoFocus: true } : {})}
              placeholder={
                where === "folder" ? baseName(path.trim()) || t("project.new.nameFromFolder") : t("project.new.example")
              }
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={submitOnEnter}
            />
          )}
        </Field>
        <Field label={t("project.settings.kind")}>
          <Select
            label={t("project.settings.kind")}
            value={kind}
            onValueChange={(v) => setKind(v ?? NO_KIND)}
            options={kindOptions(t)}
          />
        </Field>
        <Field label={t("project.settings.description")}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
