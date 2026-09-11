import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { FolderLock, RefreshCw, Trash2 } from "lucide-react";
import { Projects } from "../../lib/api";
import { Section } from "../../components/Section";
import { Button, Dialog, Empty, Loading, Textarea } from "../../components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ConfigFieldControl, type ConfigSection } from "../../components/config/ConfigTabsEditor";
import { apcProjectFields, projectBehaviourFields } from "../../components/config/project-config-sections";
import { ProjectModelsTab } from "../../components/config/ProjectModelsTab";
import { TelegramTab } from "./TelegramTab";
import { useToast } from "../../components/Toast";
import { useProject } from "../../hooks/useProjects";
import { flattenObject, getDotted, parseConfigJson } from "../../lib/config-values";
import { isSecretMarker } from "../../lib/secrets";
import { t } from "../../i18n";

const TABS = ["project", "models", "telegram", "json"] as const;
type TabKey = (typeof TABS)[number];

export function ConfigTab({ pid }: { pid: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { project, mutate: mutateProject } = useProject(pid);
  const cfg = useSWR(`/api/projects/${pid}/config`, () => Projects.config.show(pid));
  const isBase = String(pid) === "0";

  // The tab lives in the URL so a view is linkable, survives a reload, and the
  // back button walks the tabs you actually opened.
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = TABS.includes(raw as TabKey) && !(isBase && raw === "telegram")
    ? (raw as TabKey)
    : "project";
  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  if (cfg.isLoading) return <Loading />;
  if (!cfg.data) return <Empty>{t("project.config.no_data")}</Empty>;

  const saveProjectJson = async (next: Record<string, unknown>) => {
    await Projects.apcProject.put(pid, next);
    toast.success(t("project.config.save_project"));
    cfg.mutate();
  };

  const saveConfigJson = async (next: Record<string, unknown>) => {
    await Projects.config.put(pid, next);
    toast.success(t("project.config.save_override"));
    cfg.mutate();
  };

  const saveConfigFields = async (set: Record<string, unknown>, unset: string[]) => {
    if (Object.keys(set).length) await Projects.config.set(pid, set);
    if (unset.length) await Projects.config.unset(pid, unset);
    toast.success(t("project.config.save_fields_success"));
    cfg.mutate();
  };

  return (
    <div className="space-y-6">
      <Section title={t("project.config.section_title")} description={t("project.config.section_desc")}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="project">{t("project.config.tab_project")}</TabsTrigger>
            <TabsTrigger value="models">{t("settings.tabs.engines")}</TabsTrigger>
            {!isBase && <TabsTrigger value="telegram">{t("project.nav.telegram")}</TabsTrigger>}
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>

          {/* Everything about the project itself: what it is, and how its agents
              are allowed to behave. Two files behind one form — which one a
              field lands in is our problem, not the reader's. */}
          <TabsContent value="project">
            <ProjectPanel
              pid={pid}
              isBase={isBase}
              meta={cfg.data.apc_project || {}}
              projectOnly={cfg.data.project_only}
              effective={cfg.data.effective}
              onSaved={() => cfg.mutate()}
            />
          </TabsContent>

          <TabsContent value="models">
            <ProjectModelsTab
              projectOnly={cfg.data.project_only}
              effective={cfg.data.effective}
              onSaveFields={saveConfigFields}
            />
          </TabsContent>

          {!isBase && (
            <TabsContent value="telegram">
              <TelegramTab pid={pid} />
            </TabsContent>
          )}

          <TabsContent value="json">
            <div className="space-y-6">
              <JsonEditor
                title={cfg.data.project_config_path}
                description={t("project.config.json_config_desc")}
                source={cfg.data.project_only}
                onSave={saveConfigJson}
              />
              <JsonEditor
                title={cfg.data.project_json_path}
                description={t("project.config.json_meta_desc")}
                source={cfg.data.apc_project || {}}
                onSave={saveProjectJson}
              />
            </div>
          </TabsContent>
        </Tabs>
      </Section>

      {!isBase && project ? (
        <DangerZone
          pid={pid}
          label={project.name || project.path}
          onRebuilt={() => cfg.mutate()}
          onUnregistered={() => { mutateProject(); navigate("/"); }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project panel — identity (.apc/project.json) + behaviour (project config).
//
// One draft, one Save. The split between a committed metadata file and a
// machine-local config file is real and load-bearing, but it is OUR bookkeeping:
// making someone find "permission mode" in a different tab from "name" is the
// implementation leaking into the screen.
// ---------------------------------------------------------------------------

function ProjectPanel({
  pid,
  isBase,
  meta,
  projectOnly,
  effective,
  onSaved,
}: {
  pid: string;
  isBase: boolean;
  meta: Record<string, unknown>;
  projectOnly: Record<string, unknown>;
  effective: Record<string, unknown>;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // The base project has no type to pick — it is the super-agent's own store,
  // and "default" is not one of the kinds you can choose.
  const identity: ConfigSection = useMemo(() => {
    const s = apcProjectFields();
    return isBase ? { ...s, fields: s.fields.filter((f) => f.path !== "kind") } : s;
  }, [isBase]);
  const behaviour = useMemo(() => projectBehaviourFields(), []);

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => {
    const next: Record<string, unknown> = {};
    for (const f of identity.fields) next[`meta:${f.path}`] = getDotted(meta, f.path) ?? "";
    for (const f of behaviour.fields) next[`cfg:${f.path}`] = getDotted(projectOnly, f.path) ?? "";
    setDraft(next);
  }, [meta, projectOnly, identity, behaviour]);

  const save = async () => {
    setBusy(true);
    try {
      const metaSet: Record<string, unknown> = {};
      const metaUnset: string[] = [];
      for (const f of identity.fields) {
        const v = draft[`meta:${f.path}`];
        if (isSecretMarker(v)) continue;
        if (v === "" || v === undefined || v === null) metaUnset.push(f.path);
        else metaSet[f.path] = v;
      }
      const cfgSet: Record<string, unknown> = {};
      const cfgUnset: string[] = [];
      for (const f of behaviour.fields) {
        const v = draft[`cfg:${f.path}`];
        if (isSecretMarker(v)) continue;
        if (v === "" || v === undefined || v === null) cfgUnset.push(f.path);
        else cfgSet[f.path] = v;
      }

      if (Object.keys(metaSet).length || metaUnset.length) {
        await Projects.apcProject.set(pid, cleanSet(metaSet), metaUnset);
      }
      if (Object.keys(cfgSet).length) await Projects.config.set(pid, cfgSet);
      if (cfgUnset.length) await Projects.config.unset(pid, cfgUnset);

      toast.success(t("project.config.save_fields_success"));
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const group = (section: ConfigSection, prefix: "meta" | "cfg", inheritFrom?: Record<string, unknown>) => (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{section.label}</h3>
        {section.description && <p className="text-xs text-muted-fg">{section.description}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {section.fields.map((field) => (
          <ConfigFieldControl
            key={field.path}
            field={field}
            value={draft[`${prefix}:${field.path}`]}
            inherited={inheritFrom ? getDotted(inheritFrom, field.path) : undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, [`${prefix}:${field.path}`]: value }))}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {group(identity, "meta")}
      <div className="border-t border-border pt-5">{group(behaviour, "cfg", effective)}</div>
      <Button variant="primary" loading={busy} onClick={save}>{t("common.save")}</Button>
    </div>
  );
}

function DangerZone({
  pid,
  label,
  onRebuilt,
  onUnregistered,
}: {
  pid: string;
  label: string;
  onRebuilt: () => void;
  onUnregistered: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"rebuild" | "unregister" | null>(null);
  const [confirm, setConfirm] = useState<"rebuild" | "unregister" | null>(null);

  const runRebuild = async () => {
    setBusy("rebuild");
    try {
      await Projects.rebuild(pid);
      toast.success(t("project.rebuild_done"));
      onRebuilt();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const runUnregister = async () => {
    setBusy("unregister");
    try {
      await Projects.remove(pid);
      toast.success(t("project.unregistered"));
      onUnregistered();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <>
      <Section
        title={t("project.danger.title")}
        description={t("project.danger.subtitle")}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("project.rebuild")}</div>
              <div className="text-xs text-muted-fg">{t("project.danger.rebuild_desc")}</div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setConfirm("rebuild")}>
              <RefreshCw size={13} /> {t("project.rebuild")}
            </Button>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("admin.unregister")}</div>
              <div className="text-xs text-muted-fg">{t("project.danger.unregister_desc")}</div>
            </div>
            <Button size="sm" variant="destructive" onClick={() => setConfirm("unregister")}>
              <Trash2 size={13} /> {t("admin.unregister")}
            </Button>
          </div>
        </div>
      </Section>

      <Dialog
        open={confirm === "rebuild"}
        onClose={() => (busy ? null : setConfirm(null))}
        title={t("project.danger.rebuild_confirm_title")}
        description={t("project.danger.rebuild_confirm_desc", { label })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy !== null}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={runRebuild} loading={busy === "rebuild"}>
              {t("project.rebuild")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{t("project.danger.rebuild_long")}</p>
      </Dialog>

      <Dialog
        open={confirm === "unregister"}
        onClose={() => (busy ? null : setConfirm(null))}
        title={t("project.danger.unregister_confirm_title")}
        description={t("project.unregister_confirm", { label })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy !== null}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={runUnregister} loading={busy === "unregister"}>
              {t("admin.unregister")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{t("project.danger.unregister_long")}</p>
      </Dialog>
    </>
  );
}

// Raw JSON editor for one config file. Validates on every keystroke rather than
// on submit: a save that fails because of a trailing comma, after the textarea
// has already been reset by a re-render, is how you lose a paragraph of typing.
// Redacted secrets echo back untouched — the daemon restores real values on save.
function JsonEditor({
  title,
  description,
  source,
  onSave,
}: {
  title: string;
  description?: string;
  source: Record<string, unknown>;
  onSave: (next: Record<string, unknown>) => Promise<void>;
}) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRaw(JSON.stringify(source || {}, null, 2));
    setError("");
  }, [source]);

  const validate = (text: string) => {
    setRaw(text);
    try {
      parseConfigJson(text);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      await onSave(parseConfigJson(raw));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <FolderLock size={13} className="text-muted-fg" />
          <span className="font-mono">{title}</span>
        </h3>
        {description && <p className="text-xs text-muted-fg">{description}</p>}
      </div>
      <Textarea
        rows={14}
        className={`font-mono text-xs ${error ? "border-destructive" : ""}`}
        value={raw}
        onChange={(e) => validate(e.target.value)}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button variant="primary" loading={busy} disabled={!!error} onClick={save}>{t("settings_ui.save_json")}</Button>
    </div>
  );
}

function cleanSet(set: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flattenObject(set))) {
    if (!isSecretMarker(value)) out[key] = value;
  }
  return out;
}
