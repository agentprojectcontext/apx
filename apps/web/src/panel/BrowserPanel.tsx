import { BrowserTabs, EmptyState, IconButton, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserClose, loadTabs } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { nav } from "../shell/nav.ts";
import { BrowserToolbar, HandoffBar } from "./BrowserToolbar.tsx";
import { BrowserViewport } from "./BrowserViewport.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import { useActiveTab } from "./useActiveTab.ts";

/** Browser panel: tab strip in the header, toolbar (back · reload · address · who drives), then the page. */
export function BrowserPanel() {
  const t = useT();
  const { tabs, active } = useActiveTab();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadTabs();
  }, []);

  return (
    <>
      <PanelHeader
        actions={
          active && (
            <IconButton
              label={t("browser.openWindow")}
              icon={<Icons.ExternalLink size={15} />}
              onClick={() => window.open(active.url, "_blank", "noopener,noreferrer")}
            />
          )
        }
      >
        <BrowserTabs
          value={adding ? undefined : active?.tab}
          onValueChange={(id) => {
            setAdding(false);
            nav.set({ browserTab: id });
          }}
          onClose={(id) => void browserClose(id)}
          onNew={() => setAdding(true)}
          newLabel={t("browser.newTab")}
          closeLabel={t("browser.closeTab")}
          tabs={tabs.map((x) => ({ id: x.tab, title: x.title || hostPath(x.url), url: x.url, holder: x.control.kind }))}
        />
      </PanelHeader>
      {active || adding ? (
        <div className="browser">
          <BrowserToolbar tab={adding ? undefined : active} onOpened={() => setAdding(false)} />
          {!adding && active?.control.kind === "handoff" && <HandoffBar tab={active} />}
          {adding || !active ? (
            <EmptyState icon={<Icons.Globe />} title={t("browser.newTab")}>
              {t("browser.newTabHint")}
            </EmptyState>
          ) : (
            <BrowserViewport tab={active.tab} />
          )}
        </div>
      ) : (
        <div className="sidepanel__body">
          <EmptyState icon={<Icons.Globe />} title={t("browser.noTabs")}>
            {t("browser.noTabsBody")}
          </EmptyState>
        </div>
      )}
    </>
  );
}
