import { Button, Dialog } from "@apx/ui";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ExtensionTest } from "../resources/ExtensionTest.tsx";
import type { Item } from "../resources/extensionItems.ts";
import { IntegrationDetail } from "../resources/IncludedIntegration.tsx";
import { attempt, ExtensionKeys } from "../resources/InstalledExtension.tsx";
import { ExtensionConfig } from "./ExtensionConfig.tsx";

// An extension's settings, opened from ⋯ (or from its page's button when something is missing): an account's
// connection and the projects it is on in; an installed extension's settings, pages, keys and a way to try it.

export function ItemSettings({
  item,
  onClose,
  onChanged,
}: {
  item: Item;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const t = useT();
  const all = useData((s) => s.projects);
  const projects = all.filter((p) => p.path && p.registered !== false);
  const i = item.integration;
  const e = item.ext;
  const toggle = async (id: string, project: string, on: boolean) => {
    await attempt(() => client.call("mcp.toggle", { project, server: id, on }), t);
    await onChanged();
  };
  return (
    <Dialog
      open
      size="lg"
      title={t("mkt.settingsOf", { name: item.name })}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && onClose()}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="mkt-settings">
        {i && <IntegrationDetail i={i} projects={projects} onToggle={toggle} onChanged={onChanged} bare />}
        {e && <ExtensionConfig e={e} onChanged={onChanged} />}
        {e && <ExtensionKeys e={e} onChanged={onChanged} />}
        {e && <ExtensionTest e={e} />}
        {e && !e.settings.length && !e.pages.length && !e.secrets.length && (
          <p className="mkt-browse__status">{t("mkt.noSettings")}</p>
        )}
      </div>
    </Dialog>
  );
}
