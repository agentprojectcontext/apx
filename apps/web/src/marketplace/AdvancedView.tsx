import { Button, Icons } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { ExtensionGuide } from "../resources/ExtensionGuide.tsx";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import { McpDialog } from "../resources/McpDialog.tsx";
import { AddCatalogDialog, CatalogList, type CatalogsState } from "./Catalogs.tsx";

// Advanced: for whoever builds or tries extensions. The catalogs that add to Explore, installing from this computer
// (a file, a folder, a server run by a command) and the guide to build one.

export function AdvancedView({
  catalogs,
  apxCount,
  onCatalogs,
  onServers,
  onOpenCatalog,
}: {
  catalogs: CatalogsState | undefined;
  /** How many APX's own catalog offers. */
  apxCount: number | undefined;
  /** Shows a catalog's extensions in Explore. */
  onOpenCatalog(id: string): void;
  onCatalogs(): Promise<void>;
  /** After a server was added by its command. */
  onServers(): Promise<void>;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [command, setCommand] = useState(false);
  return (
    <div className="mkt-browse mkt-advanced">
      <header className="mkt-browse__head">
        <h2>{t("mkt.advanced")}</h2>
        <p>{t("mkt.advancedLead")}</p>
      </header>
      <section className="mkt-section">
        <header className="mkt-section__head">
          <h3>{t("mkt.catalogsTitle")}</h3>
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
            {t("mkt.addCatalog")}
          </Button>
        </header>
        <p className="mkt-browse__status">{t("mkt.catalogsLead")}</p>
        <CatalogList
          catalogs={catalogs?.catalogs ?? []}
          apxCount={apxCount}
          onChanged={onCatalogs}
          onOpen={onOpenCatalog}
        />
      </section>
      <section className="mkt-section">
        <header className="mkt-section__head">
          <h3>{t("mkt.fromComputer")}</h3>
        </header>
        <p className="mkt-advanced__warn">
          <Icons.TriangleAlert size={16} />
          {t("mkt.fromComputerWarn")}
        </p>
        <div className="mkt-advanced__actions">
          <Button
            variant="secondary"
            leadingIcon={<Icons.File size={14} />}
            onClick={() => openExtensionInstall({ mode: "file" })}
          >
            {t("mkt.fromFile")}
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<Icons.Folder size={14} />}
            onClick={() => openExtensionInstall({ mode: "folder" })}
          >
            {t("mkt.fromFolder")}
          </Button>
          <Button variant="secondary" leadingIcon={<Icons.Terminal size={14} />} onClick={() => setCommand(true)}>
            {t("mkt.fromCommand")}
          </Button>
        </div>
        <p className="mkt-browse__status">{t("mkt.fromCommandHint")}</p>
      </section>
      <ExtensionGuide />
      {adding && catalogs && (
        <AddCatalogDialog
          suggested={catalogs.suggested}
          added={catalogs.catalogs}
          onClose={() => setAdding(false)}
          onAdded={onCatalogs}
        />
      )}
      {command && (
        <McpDialog
          onClose={() => setCommand(false)}
          onSaved={() => {
            setCommand(false);
            void onServers();
          }}
        />
      )}
    </div>
  );
}
