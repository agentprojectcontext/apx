import { SettingRow } from "@apx/ui";
import { saveModelsConfig, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { SubHead } from "../SectionHead.tsx";
import { ModelChoicePicker } from "./ModelPickers.tsx";

/** The install default: what every agent without its own choice runs on. */
export function DefaultModel() {
  const t = useT();
  const config = useModels((s) => s.config);
  if (!config) return null;
  return (
    <div className="config__section">
      <SubHead>{t("models.defaultTitle")}</SubHead>
      <SettingRow title={t("models.defaultRow")} description={t("models.defaultDesc")}>
        <ModelChoicePicker
          className="selectbtn selectbtn--wide"
          label={t("models.defaultTitle")}
          value={config.default}
          onChange={(choice) => choice && void saveModelsConfig({ default: choice })}
        />
      </SettingRow>
    </div>
  );
}
