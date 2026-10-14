import "../styles/screens.css";
import type { Autonomy, ProjectKind } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, Select, type SelectOption, Textarea } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import type { ProjectEntry } from "../data/identity.ts";
import { updateBase, updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { type T, useT } from "../i18n/index.ts";
import { NewProjectDialog } from "../shell/NewProjectDialog.tsx";
import { go } from "../shell/nav.ts";

const KINDS: readonly ProjectKind[] = ["personal", "app", "company", "software", "other"];
/** How far agents with none of their own go here, strictest first (DECISIONS.md#d-072). */
const AUTONOMY: readonly Autonomy[] = ["ask", "standard", "edits", "total"];
const NONE = "~none";

/** A project's kind as its name ("Company"); a kind written by hand shows as it is. */
export function kindLabel(t: T, kind: string | undefined): string {
  if (!kind) return t("project.kind.unset");
  const known = KINDS.find((k) => k === kind);
  return known ? t(`project.kind.${known}`) : kind;
}

const KIND_ICON: Record<ProjectKind, typeof Icons.Folder> = {
  personal: Icons.User,
  app: Icons.AppWindow,
  company: Icons.Building2,
  software: Icons.Code,
  other: Icons.Folder,
};

/** The icon beside a project's kind; a missing or hand-written kind gets a dashed circle. */
export function kindIcon(kind: string | undefined): typeof Icons.Folder {
  const known = KINDS.find((k) => k === kind);
  return known ? KIND_ICON[known] : Icons.CircleDashed;
}

/** The kinds a project can take, as options (with "None"), shared with the setup's project step. */
export const kindOptions = (t: T): SelectOption[] => [
  { value: NONE, label: t("project.kind.none") },
  ...KINDS.map((k) => ({ value: k, label: t(`project.kind.${k}`), description: t(`project.kind.${k}.hint`) })),
];
export const NO_KIND = NONE;

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
  const real = useData((s) => s.projects.find((p) => p.id === project.id));
  const base = useData((s) => s.base);
  // The base project has no folder: APX keeps its name, description and kind.
  const full = useMemo(
    () => (project.isDefault ? { ...base, id: project.id, present: true, path: undefined } : real),
    [project.isDefault, project.id, base, real],
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<string>(NONE);
  const [autonomy, setAutonomy] = useState<Autonomy>("standard");
  const [busy, setBusy] = useState(false);
  const [newProject, setNewProject] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(full?.name ?? project.name);
    setDescription(full?.description ?? "");
    setKind(full?.kind ?? NONE);
    setAutonomy(full?.autonomy ?? "standard");
  }, [open, full, project.name]);

  const kinds: SelectOption[] = [
    ...kindOptions(t),
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
    const patch = {
      ...(name.trim() !== full.name ? { name: name.trim() } : {}),
      ...(description.trim() !== (full.description ?? "") ? { description: description.trim() || null } : {}),
      ...(kind !== (full.kind ?? NONE) && (kindValue === null || KINDS.includes(kindValue)) ? { kind: kindValue } : {}),
      ...(autonomy !== (full.autonomy ?? "standard") ? { autonomy: autonomy === "standard" ? null : autonomy } : {}),
    };
    const done = project.isDefault ? await updateBase(patch) : await updateProject({ project: full.id, ...patch });
    setBusy(false);
    if (done) close();
  };

  if (!full) return null;
  const missing = !full.present;
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("project.settings.title", { name: full.name })}
        description={project.isDefault ? t("project.settings.baseBody") : t("project.settings.body")}
        footer={
          <>
            <Button variant="secondary" leadingIcon={<Icons.Bot size={14} />} onClick={agents}>
              {t("project.agentSettings")}
            </Button>
            {project.isDefault && (
              <Button
                variant="secondary"
                leadingIcon={<Icons.FolderOpen size={14} />}
                onClick={() => {
                  close();
                  setNewProject(true);
                }}
              >
                {t("project.settings.withFolder")}
              </Button>
            )}
            <Button disabled={!name.trim() || missing} loading={busy} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="projsettings">
          <Field
            label={t("project.settings.name")}
            hint={project.isDefault ? t("project.settings.baseNameHint") : undefined}
          >
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
          <Field label={t("project.settings.autonomy")} hint={t("project.settings.autonomyHint")}>
            <Select
              label={t("project.settings.autonomy")}
              value={autonomy}
              onValueChange={(v) => v && setAutonomy(v as Autonomy)}
              options={AUTONOMY.map((a) => ({
                value: a,
                label: t(`team.autonomy.${a}`),
                description: t(`project.autonomy.${a}.hint`),
              }))}
            />
          </Field>
          {full.path && (
            <Field
              label={t("project.settings.folder")}
              hint={missing ? t("project.settings.folderMissing") : t("project.settings.folderHint")}
            >
              <code className="projsettings__path">{full.path}</code>
            </Field>
          )}
        </div>
      </Dialog>
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
    </>
  );
}
