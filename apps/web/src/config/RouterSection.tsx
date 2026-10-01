import { useEffect } from "react";
import { loadCatalog, loadModelsConfig } from "../data/models.ts";
import { useT } from "../i18n/index.ts";
import { RouterEditor } from "./models/RouterEditor.tsx";
import { SectionHead } from "./SectionHead.tsx";

/** The router every agent uses: the model chain (#1 is the default) and, separately, the content rules. */
export function RouterSection() {
  const t = useT();
  useEffect(() => {
    void loadCatalog();
    void loadModelsConfig();
  }, []);
  return (
    <>
      <SectionHead title={t("config.router")} lead={t("router.lead")} />
      <RouterEditor />
    </>
  );
}
