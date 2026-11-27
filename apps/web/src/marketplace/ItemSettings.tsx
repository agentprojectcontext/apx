import { Button, Dialog, Disclosure, Icons } from "@apx/ui";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ExtensionTest } from "../resources/ExtensionTest.tsx";
import type { Item } from "../resources/extensionItems.ts";
import { IntegrationDetail } from "../resources/IncludedIntegration.tsx";
import { attempt, canReadExtensionAgain, ExtensionKeys, ExtensionRecovery } from "../resources/InstalledExtension.tsx";
import { ExtensionConfig } from "./ExtensionConfig.tsx";
import { ExtensionNotices } from "./ExtensionNotices.tsx";

// An extension's settings, opened from ⋯ (or from its page's button when something is missing): an account's
// connection and the projects it is on in; an installed extension's settings, pages, keys and a way to try it.

const canTest = (e: NonNullable<Item["ext"]>) => e.enabled && Boolean(e.plugin?.context || e.mcp.length);

export function hasExtensionSettings(e: NonNullable<Item["ext"]>): boolean {
  return Boolean(
    e.settings.length ||
      e.pages.length ||
      e.secrets.length ||
      e.events?.length ||
      canTest(e) ||
      canReadExtensionAgain(e),
  );
}

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
  const testable = e && canTest(e);
  const recoverable = e && canReadExtensionAgain(e);
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
        {e?.events?.length ? <ExtensionNotices item={e} /> : null}
        {e && (testable || recoverable) && (
          <Disclosure title={t("mkt.optionsAdvanced")} icon={<Icons.Settings size={16} />}>
            <div className="mkt-settings mkt-settings--advanced">
              {testable && <ExtensionTest e={e} />}
              {recoverable && <ExtensionRecovery e={e} onChanged={onChanged} />}
            </div>
          </Disclosure>
        )}
      </div>
    </Dialog>
  );
}
