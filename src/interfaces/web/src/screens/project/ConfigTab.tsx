import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { RefreshCw, Trash2 } from "lucide-react";
import { Projects } from "../../lib/api";
import { Section } from "../../components/Section";
import { Button, Dialog, Empty, Loading, Textarea } from "../../components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ConfigTabsEditor } from "../../components/config/ConfigTabsEditor";
import { apcProjectSections, projectSettingsSections, projectEnginesSections } from "../../components/config/project-config-sections";
import { TelegramTab } from "./TelegramTab";
import { useToast } from "../../components/Toast";
import { useProject } from "../../hooks/useProjects";
import { flattenObject, parseConfigJson } from "../../lib/config-values";
import { isSecretMarker } from "../../lib/secrets";
import { t } from "../../i18n";

export function ConfigTab({ pid }: { pid: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { project, mutate: mutateProject } = useProject(pid);
  const cfg = useSWR(`/projects/${pid}/config`, () => Projects.config.show(pid));
  const isBase = String(pid) === "0";

  if (cfg.isLoading) return <Loading />;
  if (!cfg.data) return <Empty>{t("project.config.no_data")}</Empty>;

  const saveProjectJson = async (next: Record<string, unknown>) => {
    await Projects.apcProject.put(pid, next);
    toast.success(t("project.config.save_project"));
    cfg.mutate();
  };

  const saveOverrideJson = async (next: Record<string, unknown>) => {
    await Projects.config.put(pid, next);
    toast.success(t("project.config.save_override"));
    cfg.mutate();
  };

  const saveOverrideFields = async (set: Record<string, unknown>, unset: string[]) => {
    await Projects.config.set(pid, set);
    if (unset.length) await Projects.config.unset(pid, unset);
    toast.success(t("project.config.save_fields_success"));
    cfg.mutate();
  };

  return (
    <div className="space-y-6">
      <Section title={t("project.config.section_title")} description={t("project.config.section_desc")}>
        {/* Organized by concept: Settings · Engines · Telegram · Project · JSON. */}
        <Tabs defaultValue="settings" className="space-y-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="settings">{t("project.config.tab_settings")}</TabsTrigger>
            <TabsTrigger value="engines">{t("settings_ui.cfg_engines_label")}</TabsTrigger>
            {!isBase && <TabsTrigger value="telegram">{t("project.nav.telegram")}</TabsTrigger>}
            <TabsTrigger value="project">{t("project.config.tab_project")}</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <ConfigTabsEditor
              sections={projectSettingsSections()}
              source={cfg.data.project_only}
              placeholderSource={cfg.data.effective}
              jsonTitle={cfg.data.project_config_path}
              onSaveFields={saveOverrideFields}
              onSaveJson={saveOverrideJson}
              hideJson
            />
          </TabsContent>

          <TabsContent value="engines">
            <ConfigTabsEditor
              sections={projectEnginesSections()}
              source={cfg.data.project_only}
              placeholderSource={cfg.data.effective}
              jsonTitle={cfg.data.project_config_path}
              onSaveFields={saveOverrideFields}
              onSaveJson={saveOverrideJson}
              hideJson
            />
          </TabsContent>

          {!isBase && (
            <TabsContent value="telegram">
              <TelegramTab pid={pid} />
            </TabsContent>
          )}

          <TabsContent value="project">
            <ConfigTabsEditor
              sections={apcProjectSections()}
              source={cfg.data.apc_project || {}}
              jsonTitle={cfg.data.project_json_path}
              onSaveFields={async (set, unset) => {
                await Projects.apcProject.set(pid, cleanSet(set), unset);
                toast.success(t("project.config.save_meta_success"));
                cfg.mutate();
              }}
              onSaveJson={saveProjectJson}
              hideJson
            />
          </TabsContent>

          <TabsContent value="json">
            <div className="space-y-6">
              <JsonEditor
                title={cfg.data.project_config_path}
                description=".apc/config.json — overrides del proyecto."
                source={cfg.data.project_only}
                onSave={saveOverrideJson}
              />
              <JsonEditor
                title={cfg.data.project_json_path}
                description=".apc/project.json — metadata APC portable."
                source={cfg.data.apc_project || {}}
                onSave={saveProjectJson}
              />
              <div className="space-y-2">
                <p className="text-xs text-muted-fg">{t("project.config.effective_read")}</p>
                <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                  {JSON.stringify(cfg.data.effective, null, 2)}
                </pre>
              </div>
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

// Raw JSON editor for one config file (redacted secrets echo back untouched —
// the daemon restores real values on save).
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
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-fg">{description}</p>}
      </div>
      <Textarea rows={14} className="font-mono text-xs" value={raw} onChange={(e) => setRaw(e.target.value)} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button variant="primary" loading={busy} onClick={save}>{t("settings_ui.save_json")}</Button>
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
