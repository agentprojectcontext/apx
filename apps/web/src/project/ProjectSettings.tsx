import type { ProjectKind } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, Select, type SelectOption, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import type { ProjectEntry } from "../data/identity.ts";
import { updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewProjectDialog } from "../shell/NewProjectDialog.tsx";
import { go } from "../shell/nav.ts";

const KINDS: readonly ProjectKind[] = ["personal", "app", "company", "software", "other"];
const NONE = "~none";

/** A project's name, description and kind (kept in its .apc/project.json), and where its folder is. */
export function ProjectSettings({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectEntry;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const t = useT();
  const full = useData((s) => s.projects.find((p) => p.id === project.id));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [newProject, setNewProject] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(full?.name ?? project.name);
    setDescription(full?.description ?? "");
    setKind(full?.kind ?? NONE);
  }, [open, full, project.name]);

  const kinds: SelectOption[] = [
    { value: NONE, label: t("project.kind.none") },
    ...KINDS.map((k) => ({ value: k, label: t(`project.kind.${k}`), description: t(`project.kind.${k}.hint`) })),
    // A kind written by hand or by another tool is kept and shown as it is.
    ...(full?.kind && !(KINDS as readonly string[]).includes(full.kind)
      ? [{ value: full.kind, label: full.kind }]
      : []),
  ];
  const close = () => onOpenChange(false);
  const agents = () => {
    close();
    go.config("agents");
  };
  const save = async () => {
    if (!full || busy || !name.trim()) return;
    setBusy(true);
    const kindValue = kind === NONE ? null : (kind as ProjectKind);
    const done = await updateProject({
      project: full.id,
      ...(name.trim() !== full.name ? { name: name.trim() } : {}),
      ...(description.trim() !== (full.description ?? "") ? { description: description.trim() || null } : {}),
      ...(kind !== (full.kind ?? NONE) && (kindValue === null || KINDS.includes(kindValue)) ? { kind: kindValue } : {}),
    });
    setBusy(false);
    if (done) close();
  };

  if (project.isDefault || !full) {
    return (
      <>
        <Dialog
          open={open}
          onOpenChange={onOpenChange}
          title={t("project.settings.title", { name: project.name })}
          description={t("project.settings.baseBody")}
          footer={
            <>
              <Button variant="secondary" leadingIcon={<Icons.Bot size={14} />} onClick={agents}>
                {t("project.agentSettings")}
              </Button>
              <Button
                leadingIcon={<Icons.FolderOpen size={14} />}
                onClick={() => {
                  close();
                  setNewProject(true);
                }}
              >
                {t("project.settings.withFolder")}
              </Button>
            </>
          }
        />
        {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
      </>
    );
  }

  const missing = !full.present;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("project.settings.title", { name: full.name })}
      description={t("project.settings.body")}
      footer={
        <>
          <Button variant="secondary" leadingIcon={<Icons.Bot size={14} />} onClick={agents}>
            {t("project.agentSettings")}
          </Button>
          <Button disabled={!name.trim() || missing} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="projsettings">
        <Field label={t("project.settings.name")}>
          {(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.currentTarget.value)} />}
        </Field>
        <Field label={t("project.settings.description")}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={500}
              value={description}
              placeholder={t("project.settings.descriptionPlaceholder")}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={t("project.settings.kind")} hint={t("project.settings.kindHint")}>
          <Select
            label={t("project.settings.kind")}
            value={kind}
            onValueChange={(v) => setKind(v ?? NONE)}
            options={kinds}
          />
        </Field>
        <Field
          label={t("project.settings.folder")}
          hint={missing ? t("project.settings.folderMissing") : t("project.settings.folderHint")}
        >
          <code className="projsettings__path">{full.path}</code>
        </Field>
      </div>
    </Dialog>
  );
}
