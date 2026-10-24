import "../styles/screens.css";
import { AGENTS_MD_LIMIT, Autonomy, DEFAULT_AUTONOMY, type ProjectKind } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, Select, type SelectOption, Textarea } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { formatNumber } from "../common/format.ts";
import type { ProjectEntry } from "../data/identity.ts";
import { updateBase, updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewProjectDialog } from "../shell/NewProjectDialog.tsx";
import { go } from "../shell/nav.ts";
import { KINDS, kindOptions, NO_KIND } from "./projectKind.ts";
import { ReadOnlyFolders } from "./ReadOnlyFolders.tsx";

/** The mode agents with none of their own work in here, in the owner's order (DECISIONS.md#d-106). */
const AUTONOMY: readonly Autonomy[] = Autonomy.options;

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
  const [kind, setKind] = useState<string>(NO_KIND);
  const [autonomy, setAutonomy] = useState<Autonomy>(DEFAULT_AUTONOMY);
  const [busy, setBusy] = useState(false);
  const [newProject, setNewProject] = useState(false);
  // Filled once per opening: the project list refreshing while it is open must not undo what the owner typed.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded || !full) return;
    setName(full.name);
    setDescription(full.description ?? "");
    setKind(full.kind ?? NO_KIND);
    setAutonomy(full.autonomy ?? DEFAULT_AUTONOMY);
    setSeeded(true);
  }, [open, full, seeded]);

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
    const kindValue = kind === NO_KIND ? null : (kind as ProjectKind);
    const patch = {
      ...(name.trim() !== full.name ? { name: name.trim() } : {}),
      ...(description.trim() !== (full.description ?? "") ? { description: description.trim() || null } : {}),
      ...(kind !== (full.kind ?? NO_KIND) && (kindValue === null || KINDS.includes(kindValue))
        ? { kind: kindValue }
        : {}),
      ...(autonomy !== (full.autonomy ?? DEFAULT_AUTONOMY)
        ? { autonomy: autonomy === DEFAULT_AUTONOMY ? null : autonomy }
        : {}),
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
              onValueChange={(v) => setKind(v ?? NO_KIND)}
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
          {real?.agents_md_chars && (
            <Field label={t("project.settings.agentsMdLong")}>
              <p className="projsettings__note">
                {t("project.settings.agentsMdLongBody", {
                  chars: formatNumber(real.agents_md_chars),
                  limit: formatNumber(AGENTS_MD_LIMIT),
                })}
              </p>
            </Field>
          )}
          {!project.isDefault && real && <ReadOnlyFolders project={real} />}
        </div>
      </Dialog>
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
    </>
  );
}
