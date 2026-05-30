import useSWR from "swr";
import { Projects } from "../../lib/api";
import { Section } from "../../components/Section";
import { Empty, Loading } from "../../components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ConfigTabsEditor } from "../../components/config/ConfigTabsEditor";
import { APC_PROJECT_SECTIONS, PROJECT_OVERRIDE_SECTIONS } from "../../components/config/project-config-sections";
import { useToast } from "../../components/Toast";
import { flattenObject } from "../../lib/config-values";
import { isSecretMarker } from "../../lib/secrets";
import { t } from "../../i18n";

export function ConfigTab({ pid }: { pid: string }) {
  const toast = useToast();
  const cfg = useSWR(`/projects/${pid}/config`, () => Projects.config.show(pid));

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

  return (
    <div className="space-y-6">
      <Section title={t("project.config.section_title")} description={t("project.config.section_desc")}>
        <Tabs defaultValue="override" className="space-y-4">
          <TabsList>
            <TabsTrigger value="override">Override</TabsTrigger>
            <TabsTrigger value="project">APC project</TabsTrigger>
            <TabsTrigger value="effective">Effective</TabsTrigger>
          </TabsList>

          <TabsContent value="override">
            <ConfigTabsEditor
              sections={PROJECT_OVERRIDE_SECTIONS}
              source={cfg.data.project_only}
              placeholderSource={cfg.data.effective}
              jsonTitle={cfg.data.project_config_path}
              jsonDescription=".apc/config.json. Overrides del proyecto."
              onSaveFields={async (set, unset) => {
                await Projects.config.set(pid, set);
                if (unset.length) await Projects.config.unset(pid, unset);
                toast.success(t("project.config.save_fields_success"));
                cfg.mutate();
              }}
              onSaveJson={saveOverrideJson}
            />
          </TabsContent>

          <TabsContent value="project">
            <ConfigTabsEditor
              sections={APC_PROJECT_SECTIONS}
              source={cfg.data.apc_project || {}}
              jsonTitle={cfg.data.project_json_path}
              jsonDescription=".apc/project.json. Metadata APC portable."
              onSaveFields={async (set, unset) => {
                await Projects.apcProject.set(pid, cleanSet(set), unset);
                toast.success(t("project.config.save_meta_success"));
                cfg.mutate();
              }}
              onSaveJson={saveProjectJson}
            />
          </TabsContent>

          <TabsContent value="effective">
            <div className="space-y-2">
              <p className="text-xs text-muted-fg">{t("project.config.effective_read")}</p>
              <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                {JSON.stringify(cfg.data.effective, null, 2)}
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </Section>
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
