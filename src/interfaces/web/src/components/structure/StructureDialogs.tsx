import { useEffect, useState } from "react";
import { Dialog, Button, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { Org } from "../../lib/api/organization";
import { slugify } from "../../lib/slug";
import { t } from "../../i18n";
import type { OrgArea, OrgRole } from "../../types/daemon";

// Create or edit an area. `editing` present → edit mode (slug is immutable).
export function AreaDialog({
  open, onClose, pid, editing, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pid: string;
  editing?: OrgArea | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSlug(editing?.slug ?? "");
    setGoal(editing?.goal ?? "");
  }, [open, editing]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (editing) await Org.updateArea(pid, editing.slug, { name, goal });
      else await Org.createArea(pid, { name, slug: slug || slugify(name), goal });
      toast.success(t("common.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? t("structure.edit_area") : t("structure.new_area")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" data-testid="area-create" onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            {editing ? t("common.save") : t("structure.create_area")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("structure.name")}>
          <Input
            autoFocus
            data-testid="area-name"
            value={name}
            onChange={(e) => { setName(e.target.value); if (!editing) setSlug(slugify(e.target.value)); }}
            placeholder="Engineering"
          />
        </Field>
        {!editing && (
          <Field label={t("structure.slug")}>
            <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="font-mono" placeholder="engineering" />
          </Field>
        )}
        <Field label={t("structure.goal")} hint={t("structure.goal_hint")}>
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

// Create or edit a role. `presetArea` pre-selects an area (quick-create from an
// area card).
export function RoleDialog({
  open, onClose, pid, areas, editing, presetArea, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pid: string;
  areas: OrgArea[];
  editing?: OrgRole | null;
  presetArea?: string | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSlug(editing?.slug ?? "");
    setArea(editing?.area ?? presetArea ?? "");
    setDescription(editing?.description ?? "");
  }, [open, editing, presetArea]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (editing) await Org.updateRole(pid, editing.slug, { name, area: area || null, description });
      else await Org.createRole(pid, { name, slug: slug || slugify(name), area: area || null, description });
      toast.success(t("common.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const areaOptions = [
    { value: "", label: t("structure.no_area") },
    ...areas.map((a) => ({ value: a.slug, label: a.name })),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? t("structure.edit_role") : t("structure.new_role")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            {editing ? t("common.save") : t("structure.create_role")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("structure.name")}>
          <Input
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); if (!editing) setSlug(slugify(e.target.value)); }}
            placeholder="Tech Lead"
          />
        </Field>
        {!editing && (
          <Field label={t("structure.slug")}>
            <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="font-mono" placeholder="tech-lead" />
          </Field>
        )}
        <Field label={t("structure.area")}>
          <UiSelect value={area} onChange={setArea} options={areaOptions} placeholder={t("structure.no_area")} />
        </Field>
        <Field label={t("structure.description")}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
