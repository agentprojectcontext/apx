import { EmptyState, Icons } from "@apx/ui";
import { useT } from "../i18n/index.ts";

/**
 * Integrations (a connected account that bundles MCP servers, variables and a skill: Obsidian, GitHub, a calendar)
 * are designed but not modelled in the core yet: the tab says what it will hold.
 */
export function IntegrationsTab() {
  const t = useT();
  return (
    <div className="resvars">
      <EmptyState variant="dashed" size="lg" icon={<Icons.Plug />} title={t("res.integrations.title")}>
        {t("res.integrations.body")}
      </EmptyState>
    </div>
  );
}
