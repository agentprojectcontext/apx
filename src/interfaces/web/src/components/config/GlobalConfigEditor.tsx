import { Section } from "../Section";
import { ConfigTabsEditor } from "./ConfigTabsEditor";
import { GLOBAL_CONFIG_SECTIONS } from "./global-config-sections";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { flattenObject } from "../../lib/config-values";
import { isSecretMarker } from "../../lib/secrets";
import { Loading } from "../ui";
import { t } from "../../i18n";

export function GlobalConfigEditor() {
  const { config, isLoading, patch, mutate } = useGlobalConfig();

  if (isLoading) return <Loading />;

  const saveJson = async (next: Record<string, unknown>) => {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(flattenObject(next))) {
      if (isSecretMarker(value)) continue;
      set[key] = value;
    }
    await patch(set);
    mutate();
  };

  return (
    <Section
      title={t("global_config.title")}
      description={t("settings_ui.global_config_desc")}
    >
      <ConfigTabsEditor
        sections={GLOBAL_CONFIG_SECTIONS}
        source={config as Record<string, unknown>}
        jsonTitle="~/.apx/config.json"
        jsonDescription={t("settings_ui.global_json_desc")}
        onSaveFields={async (set, unset) => {
          await patch(set, unset);
          mutate();
        }}
        onSaveJson={saveJson}
      />
    </Section>
  );
}
