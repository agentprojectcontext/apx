import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Vars, type VarScope, type VarsList } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

interface Row {
  name: string;
  scope: VarScope;
  masked: string;
  revealed?: string;
}

export function VarsTab({ pid }: { pid: string }) {
  const toast = useToast();
  const isBase = String(pid) === "0";
  const [filter, setFilter] = useState<"all" | "project" | "global">(
    isBase ? "global" : "all",
  );
  const [revealAll, setRevealAll] = useState(false);
  const list = useSWR<VarsList>(
    `/projects/${pid}/vars?reveal=${revealAll ? 1 : 0}`,
    () => Vars.list(pid, { reveal: revealAll }),
  );
  const [openCreate, setOpenCreate] = useState<{ name?: string; value?: string; scope?: VarScope } | null>(null);

  const rows: Row[] = useMemo(() => {
    if (!list.data) return [];
    const out: Row[] = [];
    const proj = list.data.project || {};
    const glob = list.data.global || {};
    for (const [name, masked] of Object.entries(proj)) {
      out.push({ name, scope: "project", masked });
    }
    for (const [name, masked] of Object.entries(glob)) {
      if (proj[name] !== undefined) continue;
      out.push({ name, scope: "global", masked });
    }
    return out
      .filter((r) => (filter === "all" ? true : r.scope === filter))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [list.data, filter]);

  const remove = async (name: string, scope: VarScope) => {
    if (!confirm(t("project.vars.delete_confirm", { name, scope }))) return;
    try {
      await Vars.remove(pid, name, scope);
      toast.success(t("project.vars.removed"));
      list.mutate();
    } catch (e: any) {
      toast.error(e?.message || t("common.error_generic"));
    }
  };

  return (
    <Section
      title={t("project.vars.title")}
      description={
        isBase ? t("project.vars.subtitle_base") : t("project.vars.subtitle_project")
      }
      action={
        <div className="flex items-center gap-2">
          <Switch checked={revealAll} onChange={setRevealAll} label={t("project.vars.reveal_all")} />
          <Button size="sm" variant="primary" onClick={() => setOpenCreate({})}>
            <Plus size={14} /> {t("project.vars.new")}
          </Button>
        </div>
      }
    >
      {!isBase && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="text-muted-fg">{t("project.vars.filter_label")}</span>
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            {t("project.vars.filter_all")}
          </FilterPill>
          <FilterPill active={filter === "project"} onClick={() => setFilter("project")}>
            {t("project.vars.filter_project")}
          </FilterPill>
          <FilterPill active={filter === "global"} onClick={() => setFilter("global")}>
            {t("project.vars.filter_global")}
          </FilterPill>
        </div>
      )}

      {list.isLoading && <Loading />}
      {!list.isLoading && rows.length === 0 && <Empty>{t("project.vars.empty")}</Empty>}

      {rows.length > 0 && (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li
              key={`${r.scope}-${r.name}`}
              className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <span className="font-mono text-xs font-medium">{r.name}</span>
              <Badge tone={r.scope === "project" ? "info" : "muted"}>
                {r.scope === "project" ? t("project.vars.scope_project") : t("project.vars.scope_global")}
              </Badge>
              <span className="ml-2 font-mono text-xs text-muted-fg">{r.masked}</span>
              <div className="ml-auto flex items-center gap-1">
                {/* Edit: only project-scope rows can be edited from a non-base project.
                    Global rows can be edited from /p/0. We surface "edit globally" by
                    pre-filling the dialog with scope=global; the user can switch. */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpenCreate({ name: r.name, scope: r.scope })}
                  aria-label={t("project.vars.edit_btn")}
                >
                  <Pencil size={13} />
                </Button>
                {!(isBase && r.scope === "project") && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => remove(r.name, r.scope)}
                    aria-label={t("project.vars.delete_btn")}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <UpsertVarDialog
        open={openCreate !== null}
        initial={openCreate || undefined}
        onClose={() => setOpenCreate(null)}
        pid={pid}
        isBase={isBase}
        onSaved={() => {
          setOpenCreate(null);
          list.mutate();
        }}
      />
    </Section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-xs"
          : "rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs hover:bg-muted/60"
      }
    >
      {children}
    </button>
  );
}

function UpsertVarDialog({
  open,
  onClose,
  pid,
  isBase,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pid: string;
  isBase: boolean;
  initial?: { name?: string; value?: string; scope?: VarScope };
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [revealValue, setRevealValue] = useState(false);
  const [name, setName] = useState(initial?.name || "");
  const [value, setValue] = useState(initial?.value || "");
  const [scope, setScope] = useState<VarScope>(
    initial?.scope || (isBase ? "global" : "project"),
  );
  const isEdit = !!initial?.name;

  // Reset state when the dialog opens with a different initial.
  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setValue(initial?.value || "");
      setScope(initial?.scope || (isBase ? "global" : "project"));
      setRevealValue(false);
    }
  }, [open, initial?.name, initial?.scope, initial?.value, isBase]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error(t("project.vars.name_required"));
      return;
    }
    if (!value) {
      toast.error(t("project.vars.value_required"));
      return;
    }
    setBusy(true);
    try {
      await Vars.upsert(pid, { name: name.trim(), value, scope });
      toast.success(isEdit ? t("project.vars.updated") : t("project.vars.added"));
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? null : onClose())}
      title={isEdit ? t("project.vars.edit_title") : t("project.vars.new_title")}
      description={t("project.vars.new_desc")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {isEdit ? t("project.vars.save_btn") : t("project.vars.add_btn")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("project.vars.scope_label")}>
          <UiSelect
            value={scope}
            onChange={(v) => setScope(v as VarScope)}
            options={[
              ...(isBase
                ? []
                : [
                    {
                      value: "project",
                      label: t("project.vars.scope_project"),
                      description: t("project.vars.scope_project_desc"),
                    },
                  ]),
              {
                value: "global",
                label: t("project.vars.scope_global"),
                description: t("project.vars.scope_global_desc"),
              },
            ]}
          />
        </Field>
        <Field label={t("project.vars.name_label")} hint={t("project.vars.name_hint")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            placeholder="MY_API_KEY"
            disabled={isEdit}
            autoFocus={!isEdit}
          />
        </Field>
        <Field label={t("project.vars.value_label")} hint={t("project.vars.value_hint")}>
          <div className="relative">
            <Input
              type={revealValue ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isEdit ? t("project.vars.value_edit_ph") : ""}
              className="pr-9 font-mono text-xs"
              autoFocus={isEdit}
            />
            <button
              type="button"
              onClick={() => setRevealValue((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-fg hover:text-fg"
              aria-label={revealValue ? t("project.vars.hide") : t("project.vars.reveal")}
            >
              {revealValue ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
