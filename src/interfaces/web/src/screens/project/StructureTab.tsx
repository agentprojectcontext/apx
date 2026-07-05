import { useState } from "react";
import useSWR from "swr";
import { FolderKanban, Briefcase, Plus, Pencil, Trash2, Info } from "lucide-react";
import { Section } from "../../components/Section";
import { Button, Empty, Loading } from "../../components/ui";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { AreaDialog, RoleDialog } from "../../components/structure/StructureDialogs";
import { Org } from "../../lib/api/organization";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import type { OrgArea, OrgRole } from "../../types/daemon";

export function StructureTab({ pid }: { pid: string }) {
  const toast = useToast();
  const org = useSWR(`/projects/${pid}/organization`, () => Org.get(pid));

  const [areaDialog, setAreaDialog] = useState<{ editing?: OrgArea | null } | null>(null);
  const [roleDialog, setRoleDialog] = useState<{ editing?: OrgRole | null; presetArea?: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "area" | "role"; slug: string; name: string } | null>(null);

  const refresh = () => void org.mutate();

  const areas = org.data?.areas ?? [];
  const roles = org.data?.roles ?? [];
  const rolesByArea = (slug: string | null) => roles.filter((r) => r.area === slug);

  const doDelete = async () => {
    if (!confirm) return;
    if (confirm.kind === "area") await Org.removeArea(pid, confirm.slug);
    else await Org.removeRole(pid, confirm.slug);
    toast.success(t("common.deleted"));
    refresh();
  };

  return (
    <div className="space-y-6">
      <Section
        title={t("structure.title")}
        description={t("structure.subtitle")}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" data-testid="structure-new-area" onClick={() => setAreaDialog({})}>
              <Plus className="size-3.5" />{t("structure.new_area")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setRoleDialog({})}>
              <Plus className="size-3.5" />{t("structure.new_role")}
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-500" />
          <span>{t("structure.info")}</span>
        </div>

        {org.isLoading ? (
          <Loading />
        ) : areas.length === 0 && roles.length === 0 ? (
          <Empty>{t("structure.empty")}</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {areas.map((area) => (
              <div key={area.slug} className="group rounded-lg border border-border bg-card/50 p-3">
                <div className="flex items-start gap-2">
                  <FolderKanban className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{area.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{area.slug}</span>
                    </div>
                    {area.goal && <p className="mt-0.5 text-xs text-muted-foreground">{area.goal}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => setAreaDialog({ editing: area })} className="text-muted-foreground hover:text-foreground" aria-label={t("common.edit")}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setConfirm({ kind: "area", slug: area.slug, name: area.name })} className="text-muted-foreground hover:text-red-500" aria-label={t("common.delete")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Roles nested inside the area (Panda pattern). */}
                <div className="mt-3 border-t border-border/60 pt-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("structure.roles")} ({rolesByArea(area.slug).length})
                    </span>
                    <button type="button" onClick={() => setRoleDialog({ presetArea: area.slug })} className="text-[11px] text-sky-500 hover:text-sky-400">
                      + {t("structure.add_role")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rolesByArea(area.slug).map((role) => (
                      <RoleChip key={role.slug} role={role} onEdit={() => setRoleDialog({ editing: role })} onDelete={() => setConfirm({ kind: "role", slug: role.slug, name: role.name })} />
                    ))}
                    {rolesByArea(area.slug).length === 0 && <span className="text-[11px] text-muted-foreground/60">{t("structure.no_roles")}</span>}
                  </div>
                </div>
              </div>
            ))}

            {/* Unassigned roles (no area). */}
            {rolesByArea(null).length > 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card/30 p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Briefcase className="size-3.5" />{t("structure.general_roles")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rolesByArea(null).map((role) => (
                    <RoleChip key={role.slug} role={role} onEdit={() => setRoleDialog({ editing: role })} onDelete={() => setConfirm({ kind: "role", slug: role.slug, name: role.name })} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <AreaDialog open={!!areaDialog} onClose={() => setAreaDialog(null)} pid={pid} editing={areaDialog?.editing} onSaved={refresh} />
      <RoleDialog open={!!roleDialog} onClose={() => setRoleDialog(null)} pid={pid} areas={areas} editing={roleDialog?.editing} presetArea={roleDialog?.presetArea} onSaved={refresh} />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doDelete}
        title={confirm?.kind === "area" ? t("structure.delete_area") : t("structure.delete_role")}
        description={confirm?.kind === "area" ? t("structure.delete_area_desc", { name: confirm?.name ?? "" }) : t("structure.delete_role_desc", { name: confirm?.name ?? "" })}
        confirmLabel={t("common.delete")}
      />
    </div>
  );
}

function RoleChip({ role, onEdit, onDelete }: { role: OrgRole; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="group/chip inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]">
      <Briefcase className="size-3 text-muted-foreground" />
      <span>{role.name}</span>
      <button type="button" onClick={onEdit} className="opacity-0 transition-opacity group-hover/chip:opacity-100 text-muted-foreground hover:text-foreground" aria-label={t("common.edit")}>
        <Pencil className="size-2.5" />
      </button>
      <button type="button" onClick={onDelete} className="opacity-0 transition-opacity group-hover/chip:opacity-100 text-muted-foreground hover:text-red-500" aria-label={t("common.delete")}>
        <Trash2 className="size-2.5" />
      </button>
    </span>
  );
}
