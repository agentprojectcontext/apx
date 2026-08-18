import { useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Field } from "../ui";
import { Tip } from "../ui/tip";
import { UiSelect } from "../UiSelect";
import { Org } from "../../lib/api/organization";
import { t } from "../../i18n";
import type { AgentAutonomy } from "../../types/daemon";
import { AreaDialog, RoleDialog } from "../structure/StructureDialogs";
import { BlobAvatar } from "./BlobAvatar";
import { BLOB_KEYS, BLOB_PRESETS } from "./blobPresets";

// ── Agent avatar picker ──────────────────────────────────────────────────────
// The agent's avatar is a blob preset, full stop. Emoji avatars were dropped:
// one visual language beats two half-supported ones. Legacy Emoji frontmatter
// still renders (see the header/card cascade) but is no longer authorable.
export function AgentIconPicker({
  icon, onIcon,
}: {
  icon: string;
  onIcon: (v: string) => void;
}) {
  // Animate the selected blob always, and whichever one the mouse is over — so
  // the grid comes alive on hover instead of being a wall of still avatars.
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {BLOB_KEYS.map((k) => (
          <Tip key={k} content={BLOB_PRESETS[k].label}>
            <button
              type="button"
              aria-label={BLOB_PRESETS[k].label}
              aria-pressed={icon === k}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover((h) => (h === k ? null : h))}
              onFocus={() => setHover(k)}
              onBlur={() => setHover((h) => (h === k ? null : h))}
              onClick={() => onIcon(icon === k ? "" : k)}
              className={cn(
                "rounded-lg p-0.5 transition-all",
                icon === k ? "ring-2 ring-primary" : "opacity-75 hover:opacity-100",
              )}
            >
              <BlobAvatar preset={k} size={34} animated={icon === k || hover === k} seed={k} />
            </button>
          </Tip>
        ))}
      </div>
    </div>
  );
}

// ── Autonomy (permission mode) segmented control ─────────────────────────────
const AUTONOMY_OPTIONS: { value: AgentAutonomy; labelKey: "auto_total" | "auto_automatico" | "auto_permiso" }[] = [
  { value: "total", labelKey: "auto_total" },
  { value: "automatico", labelKey: "auto_automatico" },
  { value: "permiso", labelKey: "auto_permiso" },
];

export function AutonomyPicker({ value, onChange }: { value: string; onChange: (v: AgentAutonomy) => void }) {
  return (
    <div className="inline-flex w-full rounded-lg border border-border p-0.5">
      {AUTONOMY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[12px] font-medium capitalize transition-colors",
            value === opt.value ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`agents_form.${opt.labelKey}`)}
        </button>
      ))}
    </div>
  );
}

// ── Area + Role selects (fed by the project org structure) ──────────────────
// Quick-create area/role via floating dialogs (Panda's "org quick actions"),
// keeping the picker simple. On create we refetch and auto-select the new item.
export function AreaRoleFields({
  pid, area, role, onArea, onRole,
}: {
  pid: string;
  area: string;
  role: string;
  onArea: (v: string) => void;
  onRole: (v: string) => void;
}) {
  const org = useSWR(`/api/projects/${pid}/organization`, () => Org.get(pid));
  const [areaDialog, setAreaDialog] = useState(false);
  const [roleDialog, setRoleDialog] = useState(false);

  const areas = org.data?.areas ?? [];
  const roles = org.data?.roles ?? [];
  // Roles offered: those in the selected area, plus general (no-area) roles.
  const roleChoices = roles.filter((r) => (area ? r.area === area || r.area === null : true));

  const areaOptions = [{ value: "", label: t("structure.no_area") }, ...areas.map((a) => ({ value: a.slug, label: a.name }))];
  const roleOptions = [{ value: "", label: t("agents_form.no_role") }, ...roleChoices.map((r) => ({ value: r.slug, label: r.name }))];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("agents_form.area")}>
          <div className="flex items-center gap-1">
            <UiSelect value={area} onChange={(v) => { onArea(v); }} options={areaOptions} placeholder={t("structure.no_area")} className="flex-1" />
            <QuickAdd label={t("structure.new_area")} onClick={() => setAreaDialog(true)} />
          </div>
        </Field>
        <Field label={t("agents_form.role")}>
          <div className="flex items-center gap-1">
            <UiSelect value={role} onChange={onRole} options={roleOptions} placeholder={t("agents_form.no_role")} className="flex-1" />
            <QuickAdd label={t("structure.new_role")} onClick={() => setRoleDialog(true)} />
          </div>
        </Field>
      </div>

      <AreaDialog
        open={areaDialog}
        onClose={() => setAreaDialog(false)}
        pid={pid}
        onSaved={() => void org.mutate()}
      />
      <RoleDialog
        open={roleDialog}
        onClose={() => setRoleDialog(false)}
        pid={pid}
        areas={areas}
        presetArea={area || null}
        onSaved={() => void org.mutate()}
      />
    </div>
  );
}

function QuickAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Plus className="size-4" />
    </button>
  );
}
