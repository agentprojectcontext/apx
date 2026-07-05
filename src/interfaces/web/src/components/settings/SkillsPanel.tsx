import { useMemo, useState } from "react";
import useSWR from "swr";
import { Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Input, Textarea, Select, Loading, Badge, Switch, Tip } from "../ui";
import { useToast } from "../Toast";
import { Skills, type SkillEntry } from "../../lib/api/skills";
import { Projects } from "../../lib/api/projects";
import { SkillsInspectorPanel } from "./SkillsInspectorPanel";
import { t } from "../../i18n";

// Skills control surface. Lists every installed skill and lets the operator
// enable/disable each one PER SCOPE — the super-agent ("default") or a specific
// project. APX's own built-in skills are private: always active, shown locked.
// The per-turn RAG (Skill Inspector) is kept below as an advanced section.

const SUPER = "default";

function scopeSourceLabel(source: string): { label: string; tone: "info" | "success" | "muted" } {
  if (source === "builtin") return { label: t("skills_page.source_builtin"), tone: "info" };
  if (source === "project") return { label: t("skills_page.source_project"), tone: "success" };
  return { label: t("skills_page.source_global"), tone: "muted" };
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export function SkillsPanel() {
  const toast = useToast();
  const [scope, setScope] = useState<string>(SUPER);
  const [busy, setBusy] = useState(false);

  const { data: projects } = useSWR("/projects", () => Projects.list());
  const projectPath = scope === SUPER ? undefined : scope;
  const listKey = ["/skills", scope] as const;
  const { data, mutate, isLoading } = useSWR(listKey, () => Skills.list(projectPath));

  const skills = useMemo(() => data?.skills ?? [], [data]);
  const onCount = skills.filter((s) => s.enabled !== false).length;

  const setEnabled = async (slug: string, enabled: boolean | null) => {
    setBusy(true);
    try {
      await Skills.setEnabled({ slug, enabled, scope });
      await mutate();
    } catch (e) {
      toast.error(t("skills_page.toggle_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    if (!window.confirm(t("skills_page.delete_confirm", { slug }))) return;
    setBusy(true);
    try {
      await Skills.remove(slug);
      toast.success(t("skills_page.deleted_ok", { slug }));
      await mutate();
    } catch (e) {
      toast.error(t("skills_page.delete_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title={t("skills_page.list_title")}
        description={t("skills_page.list_desc")}
        action={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-fg">{t("skills_page.scope_label")}</span>
            <Select
              value={scope}
              disabled={busy}
              onChange={(e) => setScope(e.target.value)}
              className="max-w-[18rem]"
            >
              <option value={SUPER}>{t("skills_page.scope_super_agent")}</option>
              {(projects ?? []).map((p) => (
                <option key={String(p.id)} value={p.path}>
                  {p.name || basename(p.path)}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {isLoading || !data ? (
          <Loading />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="muted">
                {t("skills_page.count_label", { n: skills.length, on: onCount })}
              </Badge>
              <span className="text-xs text-muted-fg">{t("skills_page.scope_hint")}</span>
            </div>

            {skills.length === 0 ? (
              <p className="text-sm text-muted-fg">{t("skills_page.empty")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {skills.map((s) => (
                  <SkillRow
                    key={s.slug}
                    skill={s}
                    scope={scope}
                    busy={busy}
                    onToggle={(v) => setEnabled(s.slug, v)}
                    onReset={() => setEnabled(s.slug, null)}
                    onDelete={() => remove(s.slug)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      <AddSkillForm busy={busy} setBusy={setBusy} onCreated={() => mutate()} />

      <Section
        title={t("skills_page.inspector_section_title")}
        description={t("skills_page.inspector_section_desc")}
      >
        <SkillsInspectorPanel />
      </Section>
    </div>
  );
}

function SkillRow({
  skill,
  scope,
  busy,
  onToggle,
  onReset,
  onDelete,
}: {
  skill: SkillEntry;
  scope: string;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const src = scopeSourceLabel(skill.source);
  const isPrivate = !!skill.private;
  const enabled = skill.enabled !== false;
  const inProject = scope !== SUPER;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-medium">{skill.slug}</code>
          <Badge tone={src.tone}>{src.label}</Badge>
          {isPrivate && (
            <Tip content={t("skills_page.private_hint")}>
              <span className="inline-flex items-center gap-1 text-xs text-muted-fg">
                <Lock size={11} /> {t("skills_page.private_badge")}
              </span>
            </Tip>
          )}
          {!isPrivate && inProject && skill.overridden && (
            <Badge tone="warning">{t("skills_page.overridden_badge")}</Badge>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 truncate text-xs text-muted-fg">{skill.description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isPrivate && inProject && skill.overridden && (
          <Tip content={t("skills_page.reset_to_global")}>
            <Button variant="ghost" onClick={onReset} disabled={busy} aria-label={t("skills_page.reset_to_global")}>
              <RotateCcw size={14} />
            </Button>
          </Tip>
        )}
        {skill.source === "global" && (
          <Tip content={t("skills_page.delete_btn")}>
            <Button variant="ghost" onClick={onDelete} disabled={busy} aria-label={t("skills_page.delete_btn")}>
              <Trash2 size={14} />
            </Button>
          </Tip>
        )}
        <Switch
          checked={isPrivate ? true : enabled}
          disabled={busy || isPrivate}
          onChange={onToggle}
          label={(isPrivate ? true : enabled) ? t("skills_page.on") : t("skills_page.off")}
        />
      </div>
    </li>
  );
}

function AddSkillForm({
  busy,
  setBusy,
  onCreated,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");

  const valid = /^[a-z0-9][a-z0-9-]*$/.test(slug);

  const create = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await Skills.create({ slug, description, body });
      toast.success(t("skills_page.created_ok", { slug }));
      setSlug("");
      setDescription("");
      setBody("");
      onCreated();
    } catch (e) {
      toast.error(t("skills_page.create_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("skills_page.add_title")} description={t("skills_page.add_desc")}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("skills_page.add_slug_label")}>
            <Input
              value={slug}
              placeholder={t("skills_page.add_slug_ph")}
              disabled={busy}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </Field>
          <Field label={t("skills_page.add_desc_label")}>
            <Input
              value={description}
              placeholder={t("skills_page.add_desc_ph")}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("skills_page.add_body_label")}>
          <Textarea
            value={body}
            placeholder={t("skills_page.add_body_ph")}
            disabled={busy}
            rows={6}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <Button variant="primary" onClick={create} disabled={busy || !valid} loading={busy}>
          <Plus size={14} /> {t("skills_page.add_btn")}
        </Button>
      </div>
    </Section>
  );
}
