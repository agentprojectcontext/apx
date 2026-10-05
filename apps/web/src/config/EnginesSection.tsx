import { useEffect } from "react";
import { loadCatalog, loadModelsConfig } from "../data/models.ts";
import { useT } from "../i18n/index.ts";
import { ModelCatalog } from "./models/ModelCatalog.tsx";
import { PlanCards } from "./PlanCards.tsx";
import { ProvidersGrid } from "./ProvidersGrid.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";

/**
 * What agents and the router run on: the owner's plans in APX's own loop (Codex; Claude's plan only in Claude Code),
 * the model APIs (add your own), and every model each one offers. The CLIs are in External sessions.
 */
export function EnginesSection() {
  const t = useT();
  useEffect(() => {
    void loadCatalog();
    void loadModelsConfig();
  }, []);

  return (
    <>
      <SectionHead title={t("config.engines")} lead={t("engines.leadModels")} />
      <SubHead>{t("plans.title")}</SubHead>
      <p className="config__hint">{t("plans.lead")}</p>
      <PlanCards />
      <SubHead>{t("providers.title")}</SubHead>
      <p className="config__hint">{t("providers.lead")}</p>
      <ProvidersGrid />
      <ModelCatalog kind="provider" />
    </>
  );
}
